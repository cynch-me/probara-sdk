import { describe, expect, it } from 'vitest';
import type { CloseRunResponse } from './api.js';
import { closeRun, type CloseRunOptions } from './close-run.js';
import { IDEMPOTENCY_KEY_PATTERN } from './limits.js';
import type { Logger } from './logger.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2X9';
const ENV = {
  PROBARA_API_TOKEN: TOKEN,
  PROBARA_PROJECT: 'SHOP',
  PROBARA_BASE_URL: BASE_URL,
  PROBARA_RUN_ULID: RUN,
};

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function closedRun(displayId = 'R-7'): CloseRunResponse {
  return { ulid: RUN, displayId, state: 'closed' } as unknown as CloseRunResponse;
}

function apiError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message: `${code} happened` } }, headers);
}

/** Answers each request with the next response; records every request and every wait. */
function setup(responses: (Response | Error)[], options: CloseRunOptions = {}) {
  const requests: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  const fetchImpl: typeof fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body,
    });
    const next = responses.shift();
    if (next === undefined) return Promise.reject(new Error('unexpected request'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const close = () =>
    closeRun({
      env: ENV,
      fetch: fetchImpl,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0,
      logger,
      ...options,
    });
  return { close, requests, sleeps, lines };
}

describe('closeRun', () => {
  it('closes the run of PROBARA_RUN_ULID and returns it with its page', async () => {
    const { close, requests, lines } = setup([json(200, closedRun())]);
    const summary = await close();

    expect(summary).toEqual({
      status: 'closed',
      run: {
        ulid: RUN,
        displayId: 'R-7',
        state: 'closed',
        url: `${BASE_URL}/projects/SHOP/runs/R-7`,
      },
    });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(`${BASE_URL}/api/v1/runs/${RUN}/close`);
    expect(request?.method).toBe('POST');
    expect(request?.body).toBe('{}');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.headers.get('idempotency-key')).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(lines).toContainEqual(`info: Closed the run R-7: ${BASE_URL}/projects/SHOP/runs/R-7`);
  });

  it('lets explicit options win over the environment', async () => {
    const other = '01J9Z3K4M5N6P7Q8R9S0T1V2Y0';
    const { close, requests } = setup([json(200, closedRun('R-9'))], {
      run: { ulid: other.toLowerCase() },
      projectId: 'WEB',
      baseUrl: 'https://probara.example.test/',
    });
    const summary = await close();

    expect(requests[0]?.url).toBe(`https://probara.example.test/api/v1/runs/${other}/close`);
    expect(summary.run?.url).toBe('https://probara.example.test/projects/WEB/runs/R-9');
  });

  it('treats a run that is already closed (409 conflict) as done, logged at info', async () => {
    const { close, requests, lines } = setup([apiError(409, 'conflict')]);
    const summary = await close();

    expect(summary).toEqual({ status: 'already_closed' });
    expect(requests).toHaveLength(1);
    expect(lines).toContainEqual(
      `info: The run ${RUN} was already closed or aborted: nothing to close`,
    );
    expect(lines.filter((line) => /^(warn|error): /.test(line))).toEqual([]);
  });

  it('fails with the API error code of an unknown run', async () => {
    const { close, lines } = setup([apiError(404, 'not_found')]);
    const summary = await close();

    expect(summary).toEqual({
      status: 'failed',
      error: {
        message: 'Probara answered 404 not_found: not_found happened',
        code: 'not_found',
        status: 404,
      },
    });
    expect(lines).toContainEqual(
      `error: Could not close the run ${RUN}: Probara answered 404 not_found: not_found happened`,
    );
  });

  it('retries a 429 after Retry-After with the same idempotency key, then closes', async () => {
    const { close, requests, sleeps } = setup([
      apiError(429, 'too_many_requests', { 'retry-after': '2' }),
      json(200, closedRun()),
    ]);
    const summary = await close();

    expect(summary.status).toBe('closed');
    expect(sleeps).toEqual([2000]);
    const keys = requests.map((request) => request.headers.get('idempotency-key'));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('fails with a network error once every attempt failed, never throwing', async () => {
    const { close, requests } = setup(
      [new TypeError('fetch failed'), new TypeError('fetch failed')],
      { maxRetries: 1 },
    );
    const summary = await close();

    expect(requests).toHaveLength(2);
    expect(summary).toEqual({
      status: 'failed',
      error: {
        message:
          'Could not send the close request after 2 attempts: the last one failed: fetch failed',
      },
    });
  });

  it('fails without a request when no run is given', async () => {
    const { close, requests, lines } = setup([], {
      env: { ...ENV, PROBARA_RUN_ULID: undefined },
    });
    const summary = await close();

    expect(requests).toHaveLength(0);
    expect(summary).toEqual({
      status: 'failed',
      error: { message: 'The run is not set: pass run.ulid or set PROBARA_RUN_ULID' },
    });
    expect(lines).toContainEqual(
      'error: Could not close the Probara run: The run is not set: pass run.ulid or set PROBARA_RUN_ULID',
    );
  });

  it('fails without a request on a configuration problem', async () => {
    const { close, requests } = setup([], { run: { ulid: 'not-a-ulid' } });
    const summary = await close();

    expect(requests).toHaveLength(0);
    expect(summary).toEqual({ status: 'failed', error: { message: 'run.ulid is not a ULID' } });

    const twice = setup([], { run: { ulid: 'not-a-ulid' }, baseUrl: 'ftp://probara.test' });
    expect(await twice.close()).toEqual({
      status: 'failed',
      error: {
        message:
          'baseUrl must be an http(s) URL without a query or fragment; run.ulid is not a ULID',
      },
    });

    const halfConfigured = setup([], { env: { PROBARA_API_TOKEN: TOKEN, PROBARA_RUN_ULID: RUN } });
    expect(await halfConfigured.close()).toMatchObject({ status: 'failed' });
    expect(halfConfigured.requests).toHaveLength(0);
  });

  it('is disabled, and sends nothing, when reporting is off or not configured', async () => {
    const off = setup([json(200, closedRun())], { enabled: false });
    expect(await off.close()).toEqual({ status: 'disabled' });
    expect(off.requests).toHaveLength(0);

    const unconfigured = setup([json(200, closedRun())], { env: { PROBARA_RUN_ULID: RUN } });
    expect(await unconfigured.close()).toEqual({ status: 'disabled' });
    expect(unconfigured.requests).toHaveLength(0);
    expect(unconfigured.lines.filter((line) => !line.startsWith('debug: '))).toEqual([]);
  });

  it('never throws, even on options of the wrong type or a throwing logger', async () => {
    const wrong = setup([], { apiToken: 42 as unknown as string });
    expect(await wrong.close()).toEqual({
      status: 'failed',
      error: { message: 'apiToken must be a string' },
    });

    const throwing: Logger = {
      debug: () => {
        throw new Error('debug');
      },
      info: () => {
        throw new Error('info');
      },
      warn: () => {
        throw new Error('warn');
      },
      error: () => {
        throw new Error('error');
      },
    };
    const broken = setup([json(200, closedRun())], { logger: throwing });
    expect(await broken.close()).toMatchObject({ status: 'closed' });
  });

  it('never logs or returns the token, even when the server echoes it', async () => {
    const echo = json(503, {
      error: { code: 'internal_error', message: `bad header Bearer ${TOKEN}` },
    });
    const { close, lines } = setup([echo, echo], { maxRetries: 1, debug: true });
    const summary = await close();

    expect(summary.status).toBe('failed');
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });
});
