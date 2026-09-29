import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type { CloseRunResponse, ReportRequest, ReportResponse } from './api.js';
import {
  createClient,
  createIdempotencyKey,
  ProbaraApiError,
  ProbaraNetworkError,
  type ClientOptions,
} from './client.js';
import { IDEMPOTENCY_KEY_PATTERN } from './limits.js';
import type { Logger } from './logger.js';
import { VERSION } from './version.js';

const TOKEN = 'probara_live_S3CRETtoken';
const KEY = 'chunk-0f6a2c';
const NOW = Date.parse('2026-09-29T12:00:00.000Z');

const body: ReportRequest = {
  run: { name: 'Nightly', tags: ['nightly'] },
  results: [{ automationKey: 'e2e/login.spec.ts > logs in', title: 'logs in', status: 'passed' }],
  options: { close: true },
};

const recorded: ReportResponse = {
  run: { ulid: '01J9Z3K4M5N6P7Q8R9S0T1V2W3', displayId: 'R-7', state: 'closed' },
  results: [
    {
      outcome: 'recorded',
      caseUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W4',
      resultUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W5',
    },
  ],
  summary: { recorded: 1, created: 0, unmatched: 0 },
};

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function created(): Response {
  return json(201, recorded);
}

function apiError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json(
    status,
    { error: { code, message: `${code} happened`, details: { at: 1 } } },
    headers,
  );
}

/** A fetch that never answers and rejects with the signal's reason once it aborts. */
function hanging(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(init.signal?.reason as Error);
    });
  });
}

type Step = Response | Error | ((init: RequestInit) => Promise<Response>);

function harness(steps: Step[], options: Partial<ClientOptions> = {}) {
  const calls: { url: string; init: RequestInit; headers: Headers; body: unknown }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const logger: Logger = {
    debug: (message) => logs.push(`debug: ${message}`),
    info: (message) => logs.push(`info: ${message}`),
    warn: (message) => logs.push(`warn: ${message}`),
    error: (message) => logs.push(`error: ${message}`),
  };
  const fakeFetch: typeof fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init, headers: new Headers(init.headers), body: init.body });
    const step = steps.shift();
    if (step === undefined) return Promise.reject(new Error('unexpected request'));
    if (step instanceof Error) return Promise.reject(step);
    if (typeof step === 'function') return step(init);
    return Promise.resolve(step);
  };
  const client = createClient({
    baseUrl: 'https://app.probara.test/',
    apiToken: TOKEN,
    fetch: fakeFetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
    now: () => NOW,
    logger,
    ...options,
  });
  const submit = (signal?: AbortSignal) =>
    client.submitReport('SHOP', body, {
      idempotencyKey: KEY,
      ...(signal === undefined ? {} : { signal }),
    });
  return { client, calls, sleeps, logs, submit };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('createClient', () => {
  it('posts the report with its headers and returns the recorded response', async () => {
    const { client, calls } = harness([created()], { clientName: 'probara-playwright/0.1.0' });
    const response = await client.submitReport('SHOP/web ui', body, { idempotencyKey: KEY });

    expect(response).toEqual(recorded);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://app.probara.test/api/v1/projects/SHOP%2Fweb%20ui/reports');
    expect(call?.init.method).toBe('POST');
    expect(JSON.parse(call?.body as string)).toEqual(body);
    expect(Object.fromEntries(call?.headers ?? [])).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'idempotency-key': KEY,
      'user-agent': `probara-playwright/0.1.0 probara-core/${VERSION} node/${process.versions.node}`,
    });
  });

  it('sends a User-Agent without a client name when there is none', async () => {
    const { submit, calls } = harness([created()]);
    await submit();
    expect(calls[0]?.headers.get('user-agent')).toBe(
      `probara-core/${VERSION} node/${process.versions.node}`,
    );
  });

  it('rejects an invalid Idempotency-Key with a TypeError before sending', async () => {
    const { client, calls } = harness([created()]);
    for (const idempotencyKey of ['', 'has space', 'k'.repeat(256), 'clé']) {
      await expect(client.submitReport('SHOP', body, { idempotencyKey })).rejects.toThrow(
        TypeError,
      );
    }
    expect(calls).toHaveLength(0);
    await client.submitReport('SHOP', body, { idempotencyKey: 'k'.repeat(255) });
    expect(calls).toHaveLength(1);
  });

  it('rejects a token that cannot be sent in a header without echoing it', () => {
    const create = () =>
      createClient({ baseUrl: 'https://app.probara.test', apiToken: `${TOKEN}\n` });
    expect(create).toThrow(TypeError);
    expect(create).not.toThrow(TOKEN);
  });

  it('rejects maxRetries outside 0..10 and timeoutMs outside 1..600000 with a TypeError', () => {
    const create = (options: Partial<ClientOptions>) => () =>
      createClient({ baseUrl: 'https://app.probara.test', apiToken: TOKEN, ...options });
    for (const maxRetries of [-1, 1.5, 11, Number.NaN, '3' as unknown as number]) {
      expect(create({ maxRetries })).toThrow(TypeError);
    }
    for (const timeoutMs of [0, 1.5, 600_001, Number.POSITIVE_INFINITY]) {
      expect(create({ timeoutMs })).toThrow(TypeError);
    }
    for (const options of [
      { maxRetries: 0, timeoutMs: 1 },
      { maxRetries: 10, timeoutMs: 600_000 },
    ]) {
      expect(create(options)).not.toThrow();
    }
  });

  describe('retries', () => {
    it('waits Retry-After seconds after a 429 and resends with the same key', async () => {
      const { submit, calls, sleeps } = harness([
        apiError(429, 'too_many_requests', { 'retry-after': '2' }),
        created(),
      ]);
      await expect(submit()).resolves.toEqual(recorded);
      expect(sleeps).toEqual([2000]);
      expect(calls.map((call) => call.headers.get('idempotency-key'))).toEqual([KEY, KEY]);
      expect(calls.map((call) => call.body)).toEqual([JSON.stringify(body), JSON.stringify(body)]);
    });

    it('reads an HTTP-date Retry-After against the clock, capped at 120 s', async () => {
      const inFive = new Date(NOW + 5000).toUTCString();
      const { submit, sleeps } = harness([
        apiError(503, 'internal_error', { 'retry-after': inFive }),
        apiError(503, 'internal_error', { 'retry-after': '600' }),
        apiError(503, 'internal_error', { 'retry-after': new Date(NOW - 1000).toUTCString() }),
        created(),
      ]);
      await submit();
      expect(sleeps).toEqual([5000, 120_000, 0]);
    });

    it('reads a decimal Retry-After as seconds', async () => {
      const { submit, sleeps } = harness([
        apiError(503, 'internal_error', { 'retry-after': '1.5' }),
        apiError(503, 'internal_error', { 'retry-after': '0.25' }),
        created(),
      ]);
      await submit();
      expect(sleeps).toEqual([1500, 250]);
    });

    it('ends a wait between attempts as soon as the caller aborts', async () => {
      const controller = new AbortController();
      const reason = new Error('test run interrupted');
      let waits = 0;
      const { submit, calls } = harness(
        [apiError(503, 'internal_error', { 'retry-after': '120' }), created()],
        {
          // Resolves only once the wait is aborted: a sleep that ignored the signal would hang.
          sleep: (_ms, signal) =>
            new Promise((resolve) => {
              waits += 1;
              signal?.addEventListener(
                'abort',
                () => {
                  resolve();
                },
                { once: true },
              );
            }),
        },
      );
      const pending = submit(controller.signal);
      await vi.waitFor(() => {
        expect(waits).toBe(1);
      });
      controller.abort(reason);
      expect(await failureOf(pending)).toBe(reason);
      expect(calls).toHaveLength(1);
    });

    it('ends the default wait as soon as the caller aborts', async () => {
      const controller = new AbortController();
      const reason = new Error('test run interrupted');
      let calls = 0;
      const client = createClient({
        baseUrl: 'https://app.probara.test',
        apiToken: TOKEN,
        fetch: () => {
          calls += 1;
          return Promise.resolve(apiError(429, 'too_many_requests', { 'retry-after': '120' }));
        },
      });
      const pending = client.submitReport('SHOP', body, {
        idempotencyKey: KEY,
        signal: controller.signal,
      });
      await vi.waitFor(() => {
        expect(calls).toBe(1);
      });
      const abortedAt = performance.now();
      controller.abort(reason);
      expect(await failureOf(pending)).toBe(reason);
      expect(performance.now() - abortedAt).toBeLessThan(1000);
      expect(calls).toBe(1);
    });

    it('gives up after 5 attempts of 503 with an exponential backoff', async () => {
      const { submit, calls, sleeps } = harness(
        Array.from({ length: 5 }, () => apiError(503, 'internal_error')),
      );
      const error = await failureOf(submit());
      expect(error).toBeInstanceOf(ProbaraApiError);
      expect(error).toMatchObject({ status: 503, code: 'internal_error', retryable: true });
      expect(calls).toHaveLength(5);
      expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    });

    it('caps the backoff at 30 s and adds up to 20% jitter', async () => {
      const failures = () => Array.from({ length: 8 }, () => apiError(502, 'internal_error'));
      const low = harness(failures(), { maxRetries: 7, random: () => 0 });
      await failureOf(low.submit());
      expect(low.sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);

      const high = harness(failures(), { maxRetries: 7, random: () => 0.999 });
      await failureOf(high.submit());
      high.sleeps.forEach((ms, attempt) => {
        const base = low.sleeps[attempt] ?? 0;
        expect(ms).toBeGreaterThan(base * 1.19);
        expect(ms).toBeLessThanOrEqual(base * 1.2);
      });

      const half = harness(failures().slice(0, 2), { maxRetries: 1, random: () => 0.5 });
      await failureOf(half.submit());
      expect(half.sleeps).toEqual([1100]);
    });

    it('retries 408, 500, 502, 503 and 504', async () => {
      for (const status of [408, 500, 502, 503, 504]) {
        const { submit, calls } = harness([apiError(status, 'internal_error'), created()]);
        await expect(submit()).resolves.toEqual(recorded);
        expect(calls).toHaveLength(2);
      }
    });

    it('retries a 409 in-flight duplicate (with Retry-After) but not a plain 409', async () => {
      const inFlight = harness([apiError(409, 'conflict', { 'retry-after': '1' }), created()]);
      await expect(inFlight.submit()).resolves.toEqual(recorded);
      expect(inFlight.sleeps).toEqual([1000]);

      const conflict = harness([apiError(409, 'api_result_limit_exceeded'), created()]);
      const error = await failureOf(conflict.submit());
      expect(error).toMatchObject({
        status: 409,
        code: 'api_result_limit_exceeded',
        retryable: false,
      });
      expect(conflict.calls).toHaveLength(1);
    });

    it('never retries other client errors and keeps the parsed error body', async () => {
      const unprocessable = harness([apiError(422, 'validation_failed'), created()]);
      const error = await failureOf(unprocessable.submit());
      expect(error).toBeInstanceOf(ProbaraApiError);
      expect(error).toMatchObject({
        status: 422,
        code: 'validation_failed',
        details: { at: 1 },
        retryable: false,
      });
      expect(String(error)).toContain('validation_failed happened');
      expect(unprocessable.calls).toHaveLength(1);

      for (const status of [400, 401, 403, 404, 413, 415]) {
        const { submit, calls, sleeps } = harness([apiError(status, 'forbidden'), created()]);
        expect(await failureOf(submit())).toMatchObject({ status, retryable: false });
        expect(calls).toHaveLength(1);
        expect(sleeps).toEqual([]);
      }
    });

    it('stops at the first attempt with maxRetries 0', async () => {
      const { submit, calls } = harness([apiError(503, 'internal_error'), created()], {
        maxRetries: 0,
      });
      expect(await failureOf(submit())).toMatchObject({ status: 503, retryable: true });
      expect(calls).toHaveLength(1);
    });
  });

  describe('network failures', () => {
    it('retries a failed fetch', async () => {
      const { submit, calls, sleeps } = harness([new TypeError('fetch failed'), created()]);
      await expect(submit()).resolves.toEqual(recorded);
      expect(calls).toHaveLength(2);
      expect(sleeps).toEqual([1000]);
    });

    it('throws a ProbaraNetworkError describing the cause once retries are exhausted', async () => {
      const cause = new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      });
      const { submit, calls } = harness([cause, cause, cause], { maxRetries: 2 });
      const error = await failureOf(submit());
      expect(error).toBeInstanceOf(ProbaraNetworkError);
      expect((error as Error).cause).toMatchObject({
        name: 'TypeError',
        message: 'fetch failed',
        cause: { message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' },
      });
      expect((error as Error).message).toContain('fetch failed');
      expect(calls).toHaveLength(3);
    });

    it('retries a 201 whose body could not be read', async () => {
      const broken = () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('terminated'));
              },
            }),
            { status: 201 },
          ),
        );
      const { submit, calls, sleeps } = harness([broken, created()]);
      await expect(submit()).resolves.toEqual(recorded);
      expect(calls).toHaveLength(2);
      expect(sleeps).toEqual([1000]);
    });

    it('times out a 201 whose body stalls, and retries it', async () => {
      /** A 201 whose body never arrives: it errors once the request signal aborts. */
      const stalled = (init: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal?.addEventListener('abort', () => {
                  controller.error(init.signal?.reason);
                });
              },
            }),
            { status: 201 },
          ),
        );
      const retried = harness([stalled, created()], { timeoutMs: 5 });
      await expect(retried.submit()).resolves.toEqual(recorded);
      expect(retried.calls).toHaveLength(2);

      const exhausted = harness([stalled, stalled], { timeoutMs: 5, maxRetries: 1 });
      const error = await failureOf(exhausted.submit());
      expect(error).toBeInstanceOf(ProbaraNetworkError);
      expect((error as Error).message).toContain('timed out after 5 ms');

      const controller = new AbortController();
      const reason = new Error('test run interrupted');
      const aborted = harness([stalled, created()]);
      const pending = aborted.submit(controller.signal);
      await vi.waitFor(() => {
        expect(aborted.calls).toHaveLength(1);
      });
      controller.abort(reason);
      expect(await failureOf(pending)).toBe(reason);
      expect(aborted.calls).toHaveLength(1);
    });

    it('times out a stalled attempt and retries it', async () => {
      const { submit, calls } = harness([hanging, created()], { timeoutMs: 5 });
      await expect(submit()).resolves.toEqual(recorded);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.init.signal?.aborted).toBe(true);
    });

    it('reports a timeout once every attempt timed out', async () => {
      const { submit } = harness([hanging, hanging], { timeoutMs: 5, maxRetries: 1 });
      const error = await failureOf(submit());
      expect(error).toBeInstanceOf(ProbaraNetworkError);
      expect((error as Error).message).toContain('timed out after 5 ms');
    });

    it('never retries once the caller aborts', async () => {
      const controller = new AbortController();
      const { submit, calls, sleeps } = harness([hanging, created()]);
      const pending = submit(controller.signal);
      const reason = new Error('test run interrupted');
      controller.abort(reason);
      expect(await failureOf(pending)).toBe(reason);
      expect(calls).toHaveLength(1);
      expect(sleeps).toEqual([]);

      const aborted = harness([created()]);
      expect(await failureOf(aborted.submit(AbortSignal.abort(reason)))).toBe(reason);
      expect(aborted.calls).toHaveLength(0);
    });
  });

  describe('responses', () => {
    it('names an error without a JSON body after its status', async () => {
      const { submit } = harness([
        new Response('<html>Bad Gateway</html>', {
          status: 400,
          headers: { 'content-type': 'text/html' },
        }),
      ]);
      expect(await failureOf(submit())).toMatchObject({ status: 400, code: 'http_400' });
    });

    it('rejects a 201 whose body is not a report response', async () => {
      for (const response of [
        new Response('not json', { status: 201 }),
        json(201, { run: { ulid: 'x' } }),
        json(201, null),
      ]) {
        const { submit, calls } = harness([response, created()]);
        expect(await failureOf(submit())).toMatchObject({
          status: 201,
          code: 'invalid_response',
          retryable: false,
        });
        expect(calls).toHaveLength(1);
      }
    });

    it('marks an error replayed from the idempotency store', async () => {
      const replayed = harness([
        apiError(422, 'validation_failed', { 'idempotency-replayed': 'true' }),
      ]);
      expect(await failureOf(replayed.submit())).toMatchObject({ replayed: true });
      const fresh = harness([apiError(422, 'validation_failed')]);
      expect(await failureOf(fresh.submit())).not.toHaveProperty('replayed');
    });
  });

  describe('closeRun', () => {
    const RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2X9';
    const closedRun = {
      ulid: RUN,
      displayId: 'R-7',
      state: 'closed',
      closedAt: 1_790_000_000_000,
    } as unknown as CloseRunResponse;
    const close = (client: ReturnType<typeof harness>['client'], signal?: AbortSignal) =>
      client.closeRun(RUN, { idempotencyKey: KEY, ...(signal === undefined ? {} : { signal }) });

    it('posts an empty JSON body to the close route of the run and returns the closed run', async () => {
      const { client, calls } = harness([json(200, closedRun)], {
        clientName: 'probara-cli/0.1.0',
      });
      await expect(
        client.closeRun('01J9Z3K4M5N6P7Q8R9S0T1V2X9/../x', { idempotencyKey: KEY }),
      ).resolves.toEqual(closedRun);

      const [call] = calls;
      expect(call?.url).toBe(
        'https://app.probara.test/api/v1/runs/01J9Z3K4M5N6P7Q8R9S0T1V2X9%2F..%2Fx/close',
      );
      expect(call?.init.method).toBe('POST');
      expect(call?.body).toBe('{}');
      expect(Object.fromEntries(call?.headers ?? [])).toEqual({
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': KEY,
        'user-agent': `probara-cli/0.1.0 probara-core/${VERSION} node/${process.versions.node}`,
      });
    });

    it('waits Retry-After after a 429 and resends with the same key', async () => {
      const { client, calls, sleeps, logs } = harness([
        apiError(429, 'too_many_requests', { 'retry-after': '3' }),
        new TypeError('fetch failed'),
        json(200, closedRun),
      ]);
      await expect(close(client)).resolves.toEqual(closedRun);
      expect(calls.map((call) => call.headers.get('idempotency-key'))).toEqual([KEY, KEY, KEY]);
      expect(calls.map((call) => call.url)).toEqual(Array(3).fill(calls[0]?.url));
      expect(sleeps).toEqual([3000, 2000]);
      expect(logs).toContainEqual(
        'warn: Close request attempt 1 of 5 got 429; retrying in 3000 ms',
      );
    });

    it('throws the API error of a closed or unknown run without retrying it', async () => {
      const conflict = harness([apiError(409, 'conflict'), json(200, closedRun)]);
      expect(await failureOf(close(conflict.client))).toMatchObject({
        status: 409,
        code: 'conflict',
        retryable: false,
      });
      expect(conflict.calls).toHaveLength(1);

      const missing = harness([apiError(404, 'not_found')]);
      const error = await failureOf(close(missing.client));
      expect(error).toBeInstanceOf(ProbaraApiError);
      expect(error).toMatchObject({ status: 404, code: 'not_found' });
    });

    it('rejects a 200 whose body is not a run', async () => {
      const open = { ...closedRun, state: 'open' };
      for (const response of [json(200, { ulid: RUN }), json(200, [closedRun]), json(200, open)]) {
        const { client } = harness([response]);
        expect(await failureOf(close(client))).toMatchObject({
          status: 200,
          code: 'invalid_response',
        });
      }
    });

    it('describes the close in a network error once retries are exhausted', async () => {
      const { client } = harness([new TypeError('fetch failed')], { maxRetries: 0 });
      const error = await failureOf(close(client));
      expect(error).toBeInstanceOf(ProbaraNetworkError);
      expect((error as Error).message).toBe(
        'Could not send the close request after 1 attempts: the last one failed: fetch failed',
      );
    });

    it('rejects an invalid Idempotency-Key and honours an aborted signal before sending', async () => {
      const { client, calls } = harness([json(200, closedRun)]);
      await expect(client.closeRun(RUN, { idempotencyKey: 'has space' })).rejects.toThrow(
        TypeError,
      );
      const reason = new Error('stopped');
      expect(await failureOf(close(client, AbortSignal.abort(reason)))).toBe(reason);
      expect(calls).toHaveLength(0);
    });
  });

  it('logs each retry without the token, and keeps the token out of every error', async () => {
    const echo = json(503, {
      error: { code: 'internal_error', message: `bad header Bearer ${TOKEN}`, details: TOKEN },
    });
    const { submit, logs } = harness(
      [new TypeError(`fetch failed for ${TOKEN}`), apiError(429, 'too_many_requests'), echo],
      { maxRetries: 2 },
    );
    const error = await failureOf(submit());
    expect(error).toBeInstanceOf(ProbaraApiError);
    expect(logs.filter((line) => line.startsWith('warn: '))).toHaveLength(2);
    expect(logs.join('\n')).toContain('retrying in 1000 ms');
    for (const text of [...logs, (error as Error).message, String(error)]) {
      expect(text).not.toContain(TOKEN);
    }

    const network = harness([new TypeError(`connect ${TOKEN}`)], { maxRetries: 0 });
    const networkError = await failureOf(network.submit());
    expect(String(networkError)).not.toContain(TOKEN);
    expect(network.logs.join('\n')).not.toContain(TOKEN);
  });

  it('keeps the token out of the cause of a network error', async () => {
    const cause = new TypeError(`fetch failed for Bearer ${TOKEN}`, {
      cause: Object.assign(new Error(`bad header ${TOKEN}`), { code: 'UND_ERR_INVALID_ARG' }),
    });
    const { submit } = harness([cause], { maxRetries: 0 });
    const error = await failureOf(submit());
    expect(error).toBeInstanceOf(ProbaraNetworkError);
    expect(inspect(error, { depth: Number.POSITIVE_INFINITY })).not.toContain(TOKEN);
    expect((error as Error).cause).toMatchObject({
      name: 'TypeError',
      message: 'fetch failed for Bearer [redacted]',
      cause: { message: 'bad header [redacted]', code: 'UND_ERR_INVALID_ARG' },
    });
  });

  it('redacts the token from every string of the error details', async () => {
    const details = {
      header: `Bearer ${TOKEN}`,
      fields: [{ path: 'run.name', message: `echoes ${TOKEN}` }, 3, null],
      count: 2,
    };
    const { submit } = harness([
      json(422, { error: { code: 'validation_failed', message: 'invalid', details } }),
    ]);
    const error = await failureOf(submit());
    expect(error).toMatchObject({
      details: {
        header: 'Bearer [redacted]',
        fields: [{ path: 'run.name', message: 'echoes [redacted]' }, 3, null],
        count: 2,
      },
    });

    const flat = harness([
      json(422, { error: { code: 'validation_failed', message: 'invalid', details: TOKEN } }),
    ]);
    expect(await failureOf(flat.submit())).toMatchObject({ details: '[redacted]' });
  });
});

describe('createIdempotencyKey', () => {
  it('returns a fresh valid key on each call', () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(second).not.toBe(first);
  });
});
