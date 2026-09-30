import { describe, expect, it, vi } from 'vitest';
import type { CreateRunResponse } from './api.js';
import { createRun, type CreateRunOptions } from './create-run.js';
import { IDEMPOTENCY_KEY_PATTERN } from './limits.js';
import type { Logger } from './logger.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2X9';
const ENVIRONMENT = '01J9Z3K4M5N6P7Q8R9S0T1V2A1';
const MILESTONE = '01J9Z3K4M5N6P7Q8R9S0T1V2B2';
const CONFIGURATION = '01J9Z3K4M5N6P7Q8R9S0T1V2C3';
const ENV = {
  PROBARA_API_TOKEN: TOKEN,
  PROBARA_PROJECT: 'SHOP',
  PROBARA_BASE_URL: BASE_URL,
};
const NOW = new Date('2026-09-29T12:34:56.000Z');

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function createdRun(displayId = 'R-12'): CreateRunResponse {
  return { ulid: RUN, displayId, state: 'open' } as unknown as CreateRunResponse;
}

function casesRequired(): Response {
  return json(422, { error: { code: 'validation_failed', message: CASES_REQUIRED } });
}

function apiError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message: `${code} happened` } }, headers);
}

/** The server's 422 message for a create-run body without cases, plan or `automated: true`. */
const CASES_REQUIRED = 'caseUlids is required unless planUlid is supplied or automated is true';

/** Whether the server would refuse this create-run body: it has no cases to create the run with. */
function lacksCases(body: unknown): boolean {
  const fields = JSON.parse(body as string) as Record<string, unknown>;
  return (
    fields['caseUlids'] === undefined &&
    fields['planUlid'] === undefined &&
    fields['automated'] !== true
  );
}

/**
 * Answers each request with the next response; records every request and every wait. Like the
 * server, it refuses a create-run body without cases (422), whatever response comes next.
 */
function setup(responses: (Response | Error)[], options: CreateRunOptions = {}) {
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
    if (url.endsWith('/runs') && init.method === 'POST' && lacksCases(init.body)) {
      return Promise.resolve(casesRequired());
    }
    const next = responses.shift();
    if (next === undefined) return Promise.reject(new Error('unexpected request'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const create = () =>
    createRun({
      env: ENV,
      fetch: fetchImpl,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0,
      now: () => NOW,
      logger,
      ...options,
    });
  const bodyOf = (index = 0): unknown => JSON.parse(requests[index]?.body as string);
  return { create, requests, sleeps, lines, bodyOf };
}

const MAY_HAVE_BEEN_CREATED = `A run may have been created anyway: check the runs of SHOP (${BASE_URL}/projects/SHOP/runs) before creating another.`;

describe('createRun', () => {
  it('creates a run from the PROBARA_* settings and returns it with its page', async () => {
    const { create, requests, lines, bodyOf } = setup([json(201, createdRun())], {
      env: {
        ...ENV,
        PROBARA_RUN_NAME: 'Nightly',
        PROBARA_RUN_TAGS: 'nightly,e2e',
        PROBARA_ENVIRONMENT_ID: ENVIRONMENT,
        PROBARA_MILESTONE_ID: MILESTONE,
        PROBARA_CONFIGURATION_ULIDS: CONFIGURATION,
        PROBARA_BRANCH: 'main',
        PROBARA_COMMIT: 'abc1234',
        PROBARA_BUILD_URL: 'https://ci.example.test/builds/7',
      },
    });
    const summary = await create();

    expect(summary).toEqual({
      status: 'created',
      run: {
        ulid: RUN,
        displayId: 'R-12',
        state: 'open',
        url: `${BASE_URL}/projects/SHOP/runs/R-12`,
      },
    });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(`${BASE_URL}/api/v1/projects/SHOP/runs`);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.headers.get('idempotency-key')).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(bodyOf()).toEqual({
      name: 'Nightly',
      environmentId: ENVIRONMENT,
      milestoneId: MILESTONE,
      configurationUlids: [CONFIGURATION],
      tags: ['nightly', 'e2e'],
      source: { branch: 'main', commit: 'abc1234', buildUrl: 'https://ci.example.test/builds/7' },
      automated: true,
    });
    expect(lines).toContainEqual(`info: Created the run R-12: ${BASE_URL}/projects/SHOP/runs/R-12`);
  });

  it('creates a run with its description, environment, milestone, plan and configurations by name', async () => {
    const { create, bodyOf } = setup([json(201, createdRun())], {
      env: {
        ...ENV,
        PROBARA_RUN_NAME: 'Nightly',
        PROBARA_RUN_DESCRIPTION: 'Every night',
        PROBARA_ENVIRONMENT: 'staging',
        PROBARA_MILESTONE: 'M-3',
        PROBARA_PLAN: 'Release plan',
        PROBARA_CONFIGURATIONS: 'Browser=Chrome,OS=Linux',
      },
    });
    const summary = await create();

    expect(summary.status).toBe('created');
    expect(bodyOf()).toEqual({
      name: 'Nightly',
      description: 'Every night',
      environment: 'staging',
      milestone: 'M-3',
      plan: 'Release plan',
      configurations: [
        { group: 'Browser', name: 'Chrome' },
        { group: 'OS', name: 'Linux' },
      ],
      automated: true,
    });
  });

  it('creates an automated run, which needs no cases', async () => {
    const { create, bodyOf } = setup([json(201, createdRun())], { run: { name: 'Shards' } });
    const summary = await create();

    expect(summary.status).toBe('created');
    expect(bodyOf()).toMatchObject({ name: 'Shards', automated: true });
    expect(bodyOf()).not.toHaveProperty('caseUlids');
    expect(bodyOf()).not.toHaveProperty('planUlid');
  });

  it('lets explicit options win over the environment', async () => {
    const { create, requests, bodyOf, lines } = setup([json(201, createdRun('R-3'))], {
      env: { ...ENV, PROBARA_RUN_NAME: 'From env', PROBARA_RUN_TAGS: 'env' },
      projectId: 'WEB',
      baseUrl: 'https://probara.example.test/',
      run: { name: 'From options', tags: ['smoke'] },
      source: { branch: 'release/1.2' },
      clientName: 'probara-cli/0.1.0',
    });
    const summary = await create();

    expect(requests[0]?.url).toBe('https://probara.example.test/api/v1/projects/WEB/runs');
    expect(requests[0]?.headers.get('user-agent')).toMatch(/^probara-cli\/0\.1\.0 probara-core\//);
    expect(bodyOf()).toEqual({
      name: 'From options',
      tags: ['smoke'],
      source: { branch: 'release/1.2' },
      automated: true,
    });
    expect(summary.run?.url).toBe('https://probara.example.test/projects/WEB/runs/R-3');
    expect(lines).toContainEqual(
      'info: Created the run R-3: https://probara.example.test/projects/WEB/runs/R-3',
    );
  });

  it('names the run like a report would: the CI build, else the current time', async () => {
    const local = setup([json(201, createdRun())]);
    await local.create();
    expect(local.bodyOf()).toEqual({
      name: 'Automated run 2026-09-29 12:34 UTC',
      automated: true,
    });

    const github = setup([json(201, createdRun())], {
      env: {
        ...ENV,
        GITHUB_ACTIONS: 'true',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_RUN_NUMBER: '42',
        GITHUB_REF_NAME: 'feature/login',
        GITHUB_SHA: 'def5678',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/shop',
        GITHUB_RUN_ID: '991',
      },
    });
    await github.create();
    expect(github.bodyOf()).toEqual({
      name: 'CI #42',
      source: {
        branch: 'feature/login',
        commit: 'def5678',
        buildUrl: 'https://github.com/acme/shop/actions/runs/991',
      },
      automated: true,
    });
  });

  it('keeps the body inside the limits of a report-created run', async () => {
    const tags = [...Array.from({ length: 55 }, (_, index) => `tag-${index}`), 'tag-0'];
    const { create, bodyOf, lines } = setup([json(201, createdRun())], {
      run: {
        name: `  ${'n'.repeat(250)}\n`,
        tags,
        configurationUlids: [CONFIGURATION.toLowerCase(), CONFIGURATION],
      },
      source: { branch: 'main', commit: 'has space' },
    });
    await create();

    const body = bodyOf() as { name: string; tags: string[]; configurationUlids: string[] };
    expect(body.name).toHaveLength(200);
    expect(body.tags).toHaveLength(50);
    expect(body.tags[0]).toBe('tag-0');
    expect(body.configurationUlids).toEqual([CONFIGURATION]);
    expect(body).toMatchObject({ source: { branch: 'main' } });
    expect(body).not.toHaveProperty('source.commit');
    expect(lines).toContainEqual('warn: Truncated the run name to 200 characters');
    expect(lines).toContainEqual('warn: Dropped 5 run tags beyond the limit of 50');
  });

  it('sends no source when source is false, even on CI', async () => {
    const { create, bodyOf } = setup([json(201, createdRun())], {
      env: { ...ENV, PROBARA_BRANCH: 'main', PROBARA_COMMIT: 'abc1234' },
      run: { name: 'Nightly' },
      source: false,
    });
    await create();
    expect(bodyOf()).toEqual({ name: 'Nightly', automated: true });
  });

  it('fails without a request when a run is already set', async () => {
    const message =
      'A run is already set (run.ulid or PROBARA_RUN_ULID): unset it to create a new run';
    const fromEnv = setup([json(201, createdRun())], { env: { ...ENV, PROBARA_RUN_ULID: RUN } });
    expect(await fromEnv.create()).toEqual({ status: 'failed', error: { message } });
    expect(fromEnv.requests).toHaveLength(0);
    expect(fromEnv.lines).toContainEqual(`error: Could not create the Probara run: ${message}`);

    const fromOptions = setup([json(201, createdRun())], { run: { ulid: RUN } });
    expect(await fromOptions.create()).toEqual({ status: 'failed', error: { message } });
    expect(fromOptions.requests).toHaveLength(0);
  });

  it('ignores the runs and projects of other projects: it creates one run of one project', async () => {
    const other = '01J9Z3K4M5N6P7Q8R9S0T1V2W6';
    const { create, requests, lines } = setup([json(201, createdRun())], {
      env: { ...ENV, PROBARA_PROJECTS: 'WEB', PROBARA_RUN_ULIDS: `SHOP=${RUN},WEB=${other}` },
      run: { environmentId: ENVIRONMENT },
    });
    expect(await create()).toMatchObject({ status: 'created' });
    expect(requests).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('warn: '))).toEqual([]);
  });

  it('fails without a request on a configuration problem', async () => {
    const { create, requests } = setup([], { run: { environmentId: 'not-a-ulid' } });
    expect(await create()).toEqual({
      status: 'failed',
      error: { message: 'run.environmentId is not a ULID' },
    });
    expect(requests).toHaveLength(0);

    const halfConfigured = setup([], { env: { PROBARA_API_TOKEN: TOKEN } });
    expect(await halfConfigured.create()).toEqual({
      status: 'failed',
      error: { message: 'The project is not set: pass projectId or set PROBARA_PROJECT' },
    });
    expect(halfConfigured.requests).toHaveLength(0);
  });

  it('is disabled, and sends nothing, when reporting is off or not configured', async () => {
    const off = setup([json(201, createdRun())], { enabled: false });
    expect(await off.create()).toEqual({ status: 'disabled' });
    expect(off.requests).toHaveLength(0);

    const unconfigured = setup([json(201, createdRun())], { env: {} });
    expect(await unconfigured.create()).toEqual({ status: 'disabled' });
    expect(unconfigured.requests).toHaveLength(0);
    expect(unconfigured.lines.filter((line) => !line.startsWith('debug: '))).toEqual([]);
  });

  it('retries a 429 and a 503 under one idempotency key, then creates the run', async () => {
    const { create, requests, sleeps } = setup([
      apiError(429, 'too_many_requests', { 'retry-after': '2' }),
      apiError(503, 'unavailable'),
      json(201, createdRun()),
    ]);
    const summary = await create();

    expect(summary.status).toBe('created');
    expect(sleeps).toEqual([2000, 2000]);
    const keys = requests.map((request) => request.headers.get('idempotency-key'));
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
  });

  it('warns that a run may have been created when the retries run out on a network error', async () => {
    const { create, requests, lines } = setup(
      [new TypeError('fetch failed'), new TypeError('fetch failed')],
      { maxRetries: 1 },
    );
    const summary = await create();

    expect(requests).toHaveLength(2);
    const message = `Could not send the run creation after 2 attempts: the last one failed: fetch failed. ${MAY_HAVE_BEEN_CREATED}`;
    expect(summary).toEqual({ status: 'failed', error: { message } });
    expect(lines).toContainEqual(`error: Could not create the run: ${message}`);
  });

  it('warns that a run may have been created when the retries run out on a 5xx', async () => {
    const { create } = setup([apiError(500, 'internal_error'), apiError(500, 'internal_error')], {
      maxRetries: 1,
    });
    expect(await create()).toEqual({
      status: 'failed',
      error: {
        message: `Probara answered 500 internal_error: internal_error happened. ${MAY_HAVE_BEEN_CREATED}`,
        code: 'internal_error',
        status: 500,
      },
    });
  });

  it('warns that a run may have been created when the retries run out on an in-flight duplicate', async () => {
    const { create, requests } = setup(
      [
        apiError(409, 'conflict', { 'retry-after': '1' }),
        apiError(409, 'conflict', { 'retry-after': '1' }),
      ],
      { maxRetries: 1 },
    );
    expect(await create()).toEqual({
      status: 'failed',
      error: {
        message: `Probara answered 409 conflict: conflict happened. ${MAY_HAVE_BEEN_CREATED}`,
        code: 'conflict',
        status: 409,
      },
    });
    expect(requests).toHaveLength(2);
  });

  it('warns that a run may have been created when a 201 body cannot be read as a run', async () => {
    const { create } = setup([json(201, { unexpected: true })]);
    expect(await create()).toEqual({
      status: 'failed',
      error: {
        message: `Probara answered 201 with a body that is not a created run. ${MAY_HAVE_BEEN_CREATED}`,
        code: 'invalid_response',
        status: 201,
      },
    });
  });

  it('warns that a run may have been created when every attempt timed out', async () => {
    /** An attempt that never answers: it rejects once the request signal aborts. */
    const hanging: typeof fetch = (_input, init = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    const { create } = setup([], { fetch: hanging, timeoutMs: 5, maxRetries: 1 });
    expect(await create()).toEqual({
      status: 'failed',
      error: {
        message: `Could not send the run creation after 2 attempts: the last one timed out after 5 ms. ${MAY_HAVE_BEEN_CREATED}`,
      },
    });
  });

  it('fails without the duplicate warning when a 409 conflict is not an in-flight duplicate', async () => {
    const { create, requests } = setup([apiError(409, 'conflict'), json(201, createdRun())]);
    expect(await create()).toEqual({
      status: 'failed',
      error: {
        message: 'Probara answered 409 conflict: conflict happened',
        code: 'conflict',
        status: 409,
      },
    });
    expect(requests).toHaveLength(1);
  });

  it('fails with the API error of a refused run, without the duplicate warning', async () => {
    const { create, requests } = setup([
      apiError(422, 'validation_failed'),
      json(201, createdRun()),
    ]);
    expect(await create()).toEqual({
      status: 'failed',
      error: {
        message: 'Probara answered 422 validation_failed: validation_failed happened',
        code: 'validation_failed',
        status: 422,
      },
    });
    expect(requests).toHaveLength(1);
  });

  it('never throws, even on options of the wrong type or a throwing logger', async () => {
    const wrong = setup([], { apiToken: 42 as unknown as string });
    expect(await wrong.create()).toEqual({
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
    const broken = setup([json(201, createdRun())], { logger: throwing });
    expect(await broken.create()).toMatchObject({ status: 'created' });
  });

  it('resolves failed, never rejects, on options that are not an object (untyped callers)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const options of [null, 42, 'run']) {
        const summary = await createRun(options as unknown as CreateRunOptions);
        expect(summary).toEqual({
          status: 'failed',
          error: { message: 'options must be an object' },
        });
      }
      expect(error).toHaveBeenCalledWith(
        '[probara] Could not create the Probara run: options must be an object',
      );
    } finally {
      error.mockRestore();
    }
  });

  it('never logs or returns the token, even when the server echoes it', async () => {
    const echo = json(503, {
      error: { code: 'internal_error', message: `bad header Bearer ${TOKEN}` },
    });
    const { create, lines } = setup([echo, echo], { maxRetries: 1, debug: true });
    const summary = await create();

    expect(summary.status).toBe('failed');
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(TOKEN);
  });
});
