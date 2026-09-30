import { describe, expect, it } from 'vitest';
import type { Logger } from './logger.js';
import { listRunCaseKeys, type ListRunCaseKeysOptions } from './run-case-keys.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2X9';
const ENV = {
  PROBARA_API_TOKEN: TOKEN,
  PROBARA_PROJECT: 'SHOP',
  PROBARA_BASE_URL: BASE_URL,
  PROBARA_RUN_ULID: RUN,
};
const CURSOR_0 = '01J9Z3K4M5N6P7Q8R9S0T1V2W2';
const CURSOR_1 = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const CURSOR_2 = '01J9Z3K4M5N6P7Q8R9S0T1V2W4';

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function apiError(status: number, code: string): Response {
  return json(status, { error: { code, message: `${code} happened` } });
}

function key(number: number, automationKey: string | null = `cart.test.ts > test ${number}`) {
  return { caseDisplayId: `SHOP-${number}`, automationKey };
}

/** Answers each request with the next response; records every URL, every wait and every line. */
function setup(responses: (Response | Error)[], options: ListRunCaseKeysOptions = {}) {
  const urls: string[] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  const fetchImpl: typeof fetch = (input) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const next = responses.shift();
    if (next === undefined) return Promise.reject(new Error('unexpected request'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const list = () =>
    listRunCaseKeys({
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
  return { list, urls, sleeps, lines };
}

describe('listRunCaseKeys', () => {
  it('reads every page of the run of PROBARA_RUN_ULID, 200 at a time, following the cursors', async () => {
    const { list, urls, lines } = setup([
      json(200, { items: [key(1), key(2)], nextCursor: CURSOR_1 }),
      json(200, { items: [key(3, null)], nextCursor: CURSOR_2 }),
      json(200, { items: [], nextCursor: null }),
    ]);
    const summary = await list();

    expect(summary).toEqual({
      status: 'listed',
      cases: [key(1), key(2), key(3, null)],
    });
    expect(urls).toEqual([
      `${BASE_URL}/api/v1/runs/${RUN}/case-keys?limit=200`,
      `${BASE_URL}/api/v1/runs/${RUN}/case-keys?limit=200&cursor=${CURSOR_1}`,
      `${BASE_URL}/api/v1/runs/${RUN}/case-keys?limit=200&cursor=${CURSOR_2}`,
    ]);
    expect(lines).toContain(`debug: Read the 3 cases of the run ${RUN}`);
    expect(lines.filter((line) => !line.startsWith('debug: '))).toEqual([]);
  });

  it('takes run.ulid over PROBARA_RUN_ULID, and retries a page like any request', async () => {
    const other = '01J9Z3K4M5N6P7Q8R9S0T1V2Y0';
    const { list, urls, sleeps, lines } = setup(
      [apiError(503, 'internal_error'), json(200, { items: [key(1)], nextCursor: null })],
      { run: { ulid: other } },
    );

    expect(await list()).toEqual({ status: 'listed', cases: [key(1)] });
    expect(urls).toEqual(Array(2).fill(`${BASE_URL}/api/v1/runs/${other}/case-keys?limit=200`));
    expect(sleeps).toEqual([1000]);
    // The caller says what a failure means: a retry is only logged at debug.
    expect(lines).toContain(
      'debug: Run case keys request attempt 1 of 5 got 503; retrying in 1000 ms',
    );
    expect(lines.filter((line) => !line.startsWith('debug: '))).toEqual([]);
  });

  it('logs a network error it retries, and the failure after the last attempt, only at debug', async () => {
    const { list, lines } = setup(
      [new TypeError('socket hang up'), new TypeError('socket hang up')],
      { maxRetries: 1 },
    );

    expect(await list()).toMatchObject({ status: 'failed', cases: [] });
    expect(lines).toContain(
      'debug: Run case keys request attempt 1 of 2 failed: socket hang up; retrying in 1000 ms',
    );
    expect(lines.filter((line) => !line.startsWith('debug: '))).toEqual([]);
  });

  it('fails without throwing, and without what it read, when a page fails', async () => {
    const { list, lines } = setup(
      [json(200, { items: [key(1)], nextCursor: CURSOR_1 }), apiError(404, 'not_found')],
      { maxRetries: 0 },
    );
    const summary = await list();

    expect(summary).toEqual({
      status: 'failed',
      cases: [],
      error: {
        message: 'Probara answered 404 not_found: not_found happened',
        code: 'not_found',
        status: 404,
      },
    });
    expect(lines.filter((line) => !line.startsWith('debug: '))).toEqual([]);
  });

  it.each([
    ['repeats', CURSOR_1],
    ['goes back', CURSOR_0],
  ])('fails on a cursor that %s, instead of reading forever', async (_case, next) => {
    const page = json(200, { items: [key(1)], nextCursor: CURSOR_1 });
    const again = json(200, { items: [key(2)], nextCursor: next });
    const { list, urls } = setup([page, again]);

    expect(await list()).toMatchObject({
      status: 'failed',
      cases: [],
      error: {
        message: `Probara answered the cursor ${next} after ${CURSOR_1}: each cursor must sort after the one before`,
        code: 'invalid_response',
      },
    });
    expect(urls).toHaveLength(2);
  });

  it('stops after 1000 pages (200,000 cases), instead of reading forever', async () => {
    const cursor = (page: number) => `01J9Z3K4M5N6P7Q8R9${String(page).padStart(8, '0')}`;
    const pages = Array.from({ length: 1001 }, (_, index) =>
      json(200, { items: [key(index)], nextCursor: cursor(index + 1) }),
    );
    const { list, urls, lines } = setup(pages);

    expect(await list()).toEqual({
      status: 'failed',
      cases: [],
      error: {
        message:
          'The run has more than 200000 cases: stopped after 1000 pages of GET /api/v1/runs/{runUlid}/case-keys',
      },
    });
    expect(urls).toHaveLength(1000);
    expect(lines.filter((line) => !line.startsWith('debug: '))).toEqual([]);
  });

  it('reads the last page of a run of exactly 1000 pages', async () => {
    const cursor = (page: number) => `01J9Z3K4M5N6P7Q8R9${String(page).padStart(8, '0')}`;
    const pages = Array.from({ length: 1000 }, (_, index) =>
      json(200, { items: [key(index)], nextCursor: index === 999 ? null : cursor(index + 1) }),
    );
    const { list } = setup(pages);

    const summary = await list();
    expect(summary.status).toBe('listed');
    expect(summary.cases).toHaveLength(1000);
  });

  it('is disabled without a token and a project, and fails without a run, sending nothing', async () => {
    const disabled = setup([], { env: {} });
    expect(await disabled.list()).toEqual({ status: 'disabled', cases: [] });

    const noRun = setup([], { env: { ...ENV, PROBARA_RUN_ULID: undefined } });
    expect(await noRun.list()).toEqual({
      status: 'failed',
      cases: [],
      error: { message: 'The run is not set: pass run.ulid or set PROBARA_RUN_ULID' },
    });
    expect([...disabled.urls, ...noRun.urls]).toEqual([]);
  });

  it('never throws and never shows the token, even on options that are not an object', async () => {
    const summary = await listRunCaseKeys(null as unknown as ListRunCaseKeysOptions);
    expect(summary).toMatchObject({ status: 'failed', cases: [] });

    const { list } = setup([new TypeError(`fetch failed for ${TOKEN}`)], { maxRetries: 0 });
    const failed = await list();
    expect(failed.status).toBe('failed');
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
  });
});
