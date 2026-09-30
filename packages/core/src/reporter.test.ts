import { describe, expect, it, vi } from 'vitest';
import type { ReportRequest, ReportResponse, UnmatchedReason } from './api.js';
import { buildAutomationKey } from './automation-key.js';
import { IDEMPOTENCY_KEY_PATTERN } from './limits.js';
import type { Logger } from './logger.js';
import { createReporter, type ReporterOptions } from './reporter.js';
import type { TestResultInput } from './result.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const CREATED_RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SHARED_RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2X9';
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: BASE_URL };
const GITHUB_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: '4f2a9c1',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'acme/shop',
  GITHUB_RUN_ID: '42',
};

interface Failure {
  status: number;
  body: unknown;
}

interface ServerOptions {
  /** Answers every attempt of the report with this number (1-based, by idempotency key). */
  failures?: Record<number, Failure>;
  /** Automation keys or case display ids the server leaves unmatched. */
  unmatched?: Record<string, UnmatchedReason>;
  /** Automation keys the server creates a case for. */
  created?: readonly string[];
}

interface ReceivedRequest {
  url: string;
  headers: Headers;
  body: ReportRequest;
}

/** A fake of `POST /reports`: creates a run on the first report without `run.ulid`. */
function fakeServer(options: ServerOptions = {}) {
  const requests: ReceivedRequest[] = [];
  const keys: string[] = [];
  const fetchImpl: typeof fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body as string) as ReportRequest;
    requests.push({ url, headers, body });
    const key = headers.get('idempotency-key') ?? '';
    if (!keys.includes(key)) keys.push(key);
    const failure = options.failures?.[keys.indexOf(key) + 1];
    if (failure !== undefined) return Promise.resolve(json(failure.status, failure.body));

    const ulid = 'ulid' in body.run ? body.run.ulid : CREATED_RUN;
    const response: ReportResponse = {
      run: {
        ulid,
        displayId: ulid === CREATED_RUN ? 'R-12' : 'R-7',
        state: body.options?.close === true ? 'closed' : 'open',
      },
      results: body.results.map((entry) => {
        const reason =
          options.unmatched?.[entry.caseDisplayId ?? ''] ??
          options.unmatched?.[entry.automationKey ?? ''];
        if (reason !== undefined) return { outcome: 'unmatched', reason };
        const created = options.created?.includes(entry.automationKey ?? '') === true;
        return {
          outcome: 'recorded',
          caseUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W4',
          resultUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W5',
          ...(created ? { created: true as const } : {}),
        };
      }),
      summary: { recorded: 0, created: 0, unmatched: 0 },
    };
    response.summary = {
      recorded: response.results.filter((entry) => entry.outcome === 'recorded').length,
      created: response.results.filter((entry) => 'created' in entry).length,
      unmatched: response.results.filter((entry) => entry.outcome === 'unmatched').length,
    };
    return Promise.resolve(json(201, response));
  };
  return {
    fetch: fetchImpl,
    requests,
    /** The distinct reports, in the order they were first sent. */
    reports: () =>
      keys.map((key) => {
        const request = requests.find(
          (candidate) => candidate.headers.get('idempotency-key') === key,
        );
        if (request === undefined) throw new Error('missing report');
        return request.body;
      }),
  };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function capturingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  return { logger, lines, above: () => lines.filter((line) => !line.startsWith('debug: ')) };
}

function testResult(index: number, overrides: Partial<TestResultInput> = {}): TestResultInput {
  return {
    identity: { file: 'e2e/cart.spec.ts', titlePath: ['Cart', `test ${index}`] },
    status: 'passed',
    ...overrides,
  };
}

function keyOf(index: number): string {
  return buildAutomationKey({ file: 'e2e/cart.spec.ts', titlePath: ['Cart', `test ${index}`] });
}

function setup(options: ReporterOptions & { server?: ServerOptions } = {}) {
  const { server: serverOptions, ...reporterOptions } = options;
  const server = fakeServer(serverOptions);
  const log = capturingLogger();
  const reporter = createReporter({
    env: ENV,
    fetch: server.fetch,
    sleep: () => Promise.resolve(),
    random: () => 0,
    logger: log.logger,
    ...reporterOptions,
  });
  const add = (count: number) => {
    for (let index = 0; index < count; index += 1) reporter.addResult(testResult(index));
  };
  return { reporter, server, log, add };
}

describe('createReporter', () => {
  it('sends 1201 results as reports of 500, 500 and 201 into one run it closes on the last', async () => {
    const { reporter, server, add } = setup();
    add(1201);
    const summary = await reporter.complete();

    const reports = server.reports();
    expect(reports.map((report) => report.results.length)).toEqual([500, 500, 201]);
    expect(reports[0]?.run).toMatchObject({ name: expect.any(String) as string });
    expect(reports[0]?.run).not.toHaveProperty('ulid');
    expect(reports[1]?.run).toEqual({ ulid: CREATED_RUN });
    expect(reports[2]?.run).toEqual({ ulid: CREATED_RUN });
    expect(reports.map((report) => report.options?.close)).toEqual([false, false, true]);
    expect(reports.flatMap((report) => report.results.map((entry) => entry.automationKey))).toEqual(
      Array.from({ length: 1201 }, (_, index) => keyOf(index)),
    );
    expect(summary).toMatchObject({
      status: 'completed',
      recorded: 1201,
      notSent: 0,
      run: { ulid: CREATED_RUN, displayId: 'R-12', state: 'closed' },
    });
  });

  it('sends exactly 500 results as one report that closes the run', async () => {
    const { reporter, server, add } = setup();
    add(500);
    await reporter.complete();

    expect(
      server.reports().map((report) => [report.results.length, report.options?.close]),
    ).toEqual([[500, true]]);
  });

  it('sends 501 results as 500 and then 1, closing on the second', async () => {
    const { reporter, server, add } = setup();
    add(501);
    await reporter.complete();

    expect(
      server.reports().map((report) => [report.results.length, report.options?.close]),
    ).toEqual([
      [500, false],
      [1, true],
    ]);
  });

  it('honours a smaller chunkSize', async () => {
    const { reporter, server, add } = setup({ chunkSize: 2 });
    add(5);
    await reporter.complete();

    expect(
      server.reports().map((report) => [report.results.length, report.options?.close]),
    ).toEqual([
      [2, false],
      [2, false],
      [1, true],
    ]);
  });

  it('never closes the run with closeRun false', async () => {
    const { reporter, server, add } = setup({ closeRun: false, chunkSize: 2 });
    add(3);
    const summary = await reporter.complete();

    expect(server.reports().map((report) => report.options?.close)).toEqual([false, false]);
    expect(summary.run?.state).toBe('open');
  });

  it('attaches the detected CI source to the created run and to the reports that reuse it', async () => {
    const { reporter, server, add } = setup({ env: { ...ENV, ...GITHUB_ENV }, chunkSize: 1 });
    add(2);
    await reporter.complete();

    const source = {
      branch: 'main',
      commit: '4f2a9c1',
      buildUrl: 'https://github.com/acme/shop/actions/runs/42',
    };
    const [first, second] = server.reports();
    expect(first?.run).toMatchObject({ source });
    expect(second?.run).toEqual({ ulid: CREATED_RUN, source });
  });

  it('reports into a shared run from PROBARA_RUN_ULID and leaves it open by default', async () => {
    const { reporter, server, add } = setup({
      env: { ...ENV, ...GITHUB_ENV, PROBARA_RUN_ULID: SHARED_RUN },
      chunkSize: 2,
    });
    add(3);
    const summary = await reporter.complete();

    const reports = server.reports();
    expect(reports.map((report) => report.run)).toEqual([
      {
        ulid: SHARED_RUN,
        source: {
          branch: 'main',
          commit: '4f2a9c1',
          buildUrl: 'https://github.com/acme/shop/actions/runs/42',
        },
      },
      expect.objectContaining({ ulid: SHARED_RUN }),
    ]);
    expect(reports.map((report) => report.options?.close)).toEqual([false, false]);
    expect(summary.run).toMatchObject({ ulid: SHARED_RUN, displayId: 'R-7', state: 'open' });
  });

  it('sends the case options on every report', async () => {
    const suiteUlid = '01J9Z3K4M5N6P7Q8R9S0T1V2Y0';
    const { reporter, server, add } = setup({ createMissingCases: false, suiteUlid, chunkSize: 1 });
    add(2);
    await reporter.complete();

    expect(server.reports().map((report) => report.options)).toEqual([
      { createMissingCases: false, suiteUlid, close: false },
      { createMissingCases: false, suiteUlid, close: true },
    ]);
  });

  it('sends each report with its own idempotency key', async () => {
    const { reporter, server, add } = setup({ chunkSize: 1 });
    add(3);
    await reporter.complete();

    const keys = server.requests.map((request) => request.headers.get('idempotency-key') ?? '');
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(IDEMPOTENCY_KEY_PATTERN);
  });

  it('retries a failing report under the same key, then gives up without closing the run', async () => {
    const { reporter, server, add } = setup({
      maxRetries: 1,
      server: { failures: { 1: { status: 503, body: {} } } },
    });
    add(2);
    const summary = await reporter.complete();

    const keys = server.requests.map((request) => request.headers.get('idempotency-key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(summary).toMatchObject({ status: 'failed', recorded: 0, notSent: 2 });
    expect(summary.errors).toEqual([expect.objectContaining({ status: 503, code: 'http_503' })]);
  });

  it('stops after a rejected report: the rest is not sent and the run stays open', async () => {
    const { reporter, server, log, add } = setup({
      server: {
        failures: {
          2: {
            status: 422,
            body: { error: { code: 'validation_failed', message: 'results.3.title is too long' } },
          },
        },
      },
    });
    add(1201);
    const summary = await reporter.complete();

    const reports = server.reports();
    expect(reports).toHaveLength(2);
    expect(reports.every((report) => report.options?.close === false)).toBe(true);
    expect(summary).toMatchObject({
      status: 'partial',
      recorded: 500,
      notSent: 701,
      run: { ulid: CREATED_RUN, state: 'open' },
    });
    expect(summary.errors).toEqual([
      {
        message: expect.stringContaining('results.3.title is too long') as string,
        code: 'validation_failed',
        status: 422,
      },
    ]);
    expect(log.lines.filter((line) => line.startsWith('error: '))).toEqual([
      expect.stringMatching(/701 results were not sent.*R-12.*left open/),
    ]);
  });

  it('fails the whole session when the first report is unauthorized', async () => {
    const { reporter, server, add } = setup({
      chunkSize: 2,
      server: {
        failures: { 1: { status: 401, body: { error: { code: 'unauthorized', message: 'no' } } } },
      },
    });
    add(5);
    const summary = await reporter.complete();

    expect(server.requests).toHaveLength(1);
    expect(summary).toMatchObject({ status: 'failed', recorded: 0, notSent: 5 });
    expect(summary.run).toBeUndefined();
    expect(summary.errors).toEqual([
      expect.objectContaining({ code: 'unauthorized', status: 401 }),
    ]);
  });

  it('stays quiet and sends nothing when reporting is not configured', async () => {
    const { reporter, server, log, add } = setup({ env: {} });
    add(3);
    const summary = await reporter.complete();

    expect(reporter.enabled).toBe(false);
    expect(server.requests).toHaveLength(0);
    expect(summary).toMatchObject({ status: 'disabled', recorded: 0, notSent: 0, invalid: 0 });
    expect(log.above()).toEqual([]);
    expect(log.lines.join('\n')).toContain('not configured');
  });

  it('stays quiet and sends nothing when disabled explicitly', async () => {
    const { reporter, server, log, add } = setup({ enabled: false });
    add(3);
    const summary = await reporter.complete();

    expect(reporter.enabled).toBe(false);
    expect(server.requests).toHaveLength(0);
    expect(summary.status).toBe('disabled');
    expect(log.above()).toEqual([]);
  });

  it('turns reporting off with an error for each configuration problem', async () => {
    const { reporter, server, log, add } = setup({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_CLOSE_RUN: 'maybe' },
    });
    add(2);
    const summary = await reporter.complete();

    expect(reporter.enabled).toBe(false);
    expect(server.requests).toHaveLength(0);
    expect(summary).toMatchObject({ status: 'failed', recorded: 0, notSent: 2 });
    expect(summary.errors).toHaveLength(2);
    const errors = log.lines.filter((line) => line.startsWith('error: '));
    expect(errors).toEqual([
      expect.stringMatching(/Probara reporting is off: .*PROBARA_PROJECT/),
      expect.stringMatching(/Probara reporting is off: .*PROBARA_CLOSE_RUN/),
    ]);
  });

  it('turns reporting off when the token cannot be sent in a header', async () => {
    const { reporter, server, add } = setup({ apiToken: 'probara_live two words' });
    add(1);
    const summary = await reporter.complete();

    expect(server.requests).toHaveLength(0);
    expect(summary.status).toBe('failed');
    expect(JSON.stringify(summary)).not.toContain('two words');
  });

  it('counts invalid results and still sends the others in order', async () => {
    const { reporter, server, log } = setup();
    reporter.addResult(testResult(0));
    reporter.addResult(testResult(1, { status: 'exploded' as TestResultInput['status'] }));
    reporter.addResult({ identity: { titlePath: ['  '] }, status: 'passed' });
    reporter.addResult(null as unknown as TestResultInput);
    reporter.addResult(testResult(2));
    const summary = await reporter.complete();

    expect(server.reports()[0]?.results.map((entry) => entry.automationKey)).toEqual([
      keyOf(0),
      keyOf(2),
    ]);
    expect(summary).toMatchObject({ status: 'completed', recorded: 2, invalid: 3 });
    expect(log.lines).toContainEqual(expect.stringMatching(/^warn: .*Cart > test 1.*exploded/));
  });

  it('sends a result that links several cases once per case, with the same key, in order', async () => {
    const { reporter, server } = setup({ chunkSize: 2 });
    reporter.addResult(testResult(0));
    reporter.addResult(
      testResult(1, {
        status: 'failed',
        caseDisplayId: 'SHOP-1',
        caseDisplayIds: ['SHOP-2', 'SHOP-1', 'SHOP-3'],
      }),
    );
    reporter.addResult(testResult(2, { caseDisplayIds: ['SHOP-9'] }));
    const summary = await reporter.complete();

    const entries = server.reports().flatMap((report) => report.results);
    expect(
      entries.map((entry) => [entry.automationKey, entry.caseDisplayId, entry.status]),
    ).toEqual([
      [keyOf(0), undefined, 'passed'],
      [keyOf(1), 'SHOP-1', 'failed'],
      [keyOf(1), 'SHOP-2', 'failed'],
      [keyOf(1), 'SHOP-3', 'failed'],
      [keyOf(2), 'SHOP-9', 'passed'],
    ]);
    // Each case counts as one result towards the chunk size.
    expect(server.reports().map((report) => report.results.length)).toEqual([2, 2, 1]);
    expect(summary).toMatchObject({ status: 'completed', recorded: 5, invalid: 0 });
  });

  it('counts an invalid result that links several cases once', async () => {
    const { reporter, server } = setup();
    reporter.addResult(
      testResult(0, {
        status: 'exploded' as TestResultInput['status'],
        caseDisplayIds: ['SHOP-1', 'SHOP-2'],
      }),
    );
    reporter.addResult(testResult(1));
    const summary = await reporter.complete();

    expect(server.reports()[0]?.results.map((entry) => entry.automationKey)).toEqual([keyOf(1)]);
    expect(summary).toMatchObject({ recorded: 1, invalid: 1 });
  });

  it('logs a repeated conversion warning once at warn', async () => {
    const { reporter, log } = setup();
    reporter.addResult(testResult(0, { durationMs: Number.NaN }));
    reporter.addResult(testResult(1, { durationMs: Number.NaN }));
    reporter.addResult(testResult(2, { startedAt: 'not a date' }));
    await reporter.complete();

    const warnings = log.lines.filter((line) => line.startsWith('warn: '));
    expect(warnings).toEqual([
      expect.stringContaining('durationMs'),
      expect.stringContaining('startedAt'),
    ]);
  });

  it('surfaces unmatched results with their labels and counts created cases', async () => {
    const { reporter, log } = setup({
      server: {
        unmatched: { [keyOf(1)]: 'case_not_found', 'PRB-404': 'invalid_display_id' },
        created: [keyOf(0)],
      },
    });
    reporter.addResult(testResult(0));
    reporter.addResult(testResult(1, { title: 'Adds an item' }));
    reporter.addResult(testResult(2, { caseDisplayId: 'PRB-404' }));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'completed', recorded: 1, created: 1 });
    expect(summary.unmatched).toEqual([
      { reason: 'case_not_found', automationKey: keyOf(1), title: 'Adds an item' },
      {
        reason: 'invalid_display_id',
        automationKey: keyOf(2),
        caseDisplayId: 'PRB-404',
        title: 'test 2',
      },
    ]);
    const warnings = log.lines.filter((line) => line.startsWith('warn: '));
    expect(warnings).toEqual([
      expect.stringMatching(/1 result.*case_not_found.*Cart > test 1/),
      expect.stringMatching(/1 result.*invalid_display_id.*PRB-404/),
    ]);
  });

  it('logs one info line with the counts and the run link', async () => {
    const { reporter, log } = setup({
      server: { created: [keyOf(0)], unmatched: { [keyOf(2)]: 'title_required' } },
    });
    reporter.addResult(testResult(0));
    reporter.addResult(testResult(1));
    reporter.addResult(testResult(2));
    const summary = await reporter.complete();

    expect(summary.run?.url).toBe(`${BASE_URL}/projects/SHOP/runs/R-12`);
    expect(log.lines.filter((line) => line.startsWith('info: '))).toEqual([
      `info: Recorded 2 results (1 new case, 1 unmatched) in R-12 (closed): ${BASE_URL}/projects/SHOP/runs/R-12`,
    ]);
  });

  it('encodes the project in the run link', async () => {
    const { reporter, add } = setup({ projectId: 'SHOP/web ui' });
    add(1);
    const summary = await reporter.complete();

    expect(summary.run?.url).toBe(`${BASE_URL}/projects/SHOP%2Fweb%20ui/runs/R-12`);
  });

  it('sends nothing and reports empty without results', async () => {
    const { reporter, server } = setup();
    const summary = await reporter.complete();

    expect(reporter.enabled).toBe(true);
    expect(server.requests).toHaveLength(0);
    expect(summary).toEqual({
      status: 'empty',
      recorded: 0,
      created: 0,
      unmatched: [],
      invalid: 0,
      notSent: 0,
      errors: [],
      attachments: { uploaded: 0, skipped: 0, failed: 0 },
      attachmentErrors: [],
    });
  });

  it('completes once however often complete is called', async () => {
    const { reporter, server, add } = setup({ chunkSize: 2 });
    add(3);
    const first = reporter.complete();
    const second = reporter.complete();

    expect(second).toBe(first);
    await first;
    expect(await reporter.complete()).toBe(await first);
    expect(server.reports()).toHaveLength(2);
  });

  it('ignores results added after complete, with a single warning', async () => {
    const { reporter, server, log, add } = setup();
    add(1);
    await reporter.complete();
    reporter.addResult(testResult(7));
    reporter.addResult(testResult(8));
    await reporter.complete();

    expect(server.requests).toHaveLength(1);
    expect(log.lines.filter((line) => line.includes('after complete'))).toHaveLength(1);
  });

  it('never lets the token reach a log line or the summary', async () => {
    const { reporter, log } = setup({
      env: { ...ENV, PROBARA_DEBUG: 'true' },
      server: {
        failures: {
          1: {
            status: 422,
            body: { error: { code: 'validation_failed', message: `bad token ${TOKEN}` } },
          },
        },
      },
    });
    reporter.addResult(testResult(0, { title: `leaks ${TOKEN}` }));
    reporter.addResult(testResult(1, { status: TOKEN as TestResultInput['status'] }));
    const summary = await reporter.complete();

    expect(log.lines.length).toBeGreaterThan(0);
    expect(log.lines.join('\n')).not.toContain(TOKEN);
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
  });

  it('completes even when the logger throws', async () => {
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
    const { reporter, add } = setup({
      logger: throwing,
      maxRetries: 1,
      server: { failures: { 2: { status: 503, body: {} } } },
      chunkSize: 1,
    });
    add(3);
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'partial', recorded: 1, notSent: 2 });
  });

  it('turns reporting off instead of throwing on a malformed option', async () => {
    const { logger, lines } = capturingLogger();
    const server = fakeServer();
    const create = () =>
      createReporter({
        env: ENV,
        fetch: server.fetch,
        logger,
        run: { tags: 'nightly' as unknown as string[] },
      });

    expect(create).not.toThrow();
    const reporter = create();
    reporter.addResult(testResult(0));
    const summary = await reporter.complete();

    expect(reporter.enabled).toBe(false);
    expect(server.requests).toHaveLength(0);
    expect(summary).toMatchObject({ status: 'failed', notSent: 1 });
    expect(summary.errors).toEqual([{ message: 'run.tags must be a list of strings' }]);
    expect(lines).toContainEqual(
      'error: Probara reporting is off: run.tags must be a list of strings',
    );
  });

  it('still reports, without the field, when an explicit source field is not a string', async () => {
    const { reporter, server, log, add } = setup({
      env: { ...ENV, ...GITHUB_ENV },
      source: { branch: 42 } as unknown as ReporterOptions['source'],
    });
    add(1);
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'completed', recorded: 1 });
    expect(server.reports()[0]?.run.source).toEqual({
      commit: '4f2a9c1',
      buildUrl: 'https://github.com/acme/shop/actions/runs/42',
    });
    expect(log.lines).toContainEqual('warn: Ignored source.branch: it must be a string');
  });

  it('turns reporting off instead of throwing on options of the wrong type', async () => {
    const { reporter, server, add } = setup({ apiToken: 42 as unknown as string });
    add(1);
    const summary = await reporter.complete();

    expect(reporter.enabled).toBe(false);
    expect(server.requests).toHaveLength(0);
    expect(summary).toMatchObject({ status: 'failed', notSent: 1 });
    expect(summary.errors).toEqual([{ message: 'apiToken must be a string' }]);

    const create = () =>
      createReporter({
        env: ENV,
        logger: capturingLogger().logger,
        apiToken: 42 as unknown as string,
        run: { tags: 'nightly' as unknown as string[] },
      });
    expect(create).not.toThrow();
    expect(await create().complete()).toMatchObject({ status: 'failed' });
  });

  it('fails with the network error when every attempt of the first report fails', async () => {
    let attempts = 0;
    const { reporter, add } = setup({
      maxRetries: 1,
      fetch: () => {
        attempts += 1;
        return Promise.reject(new TypeError('fetch failed'));
      },
    });
    add(2);
    const summary = await reporter.complete();

    expect(attempts).toBe(2);
    expect(summary).toMatchObject({ status: 'failed', recorded: 0, notSent: 2 });
    expect(summary.run).toBeUndefined();
    expect(summary.errors).toEqual([
      {
        message: expect.stringContaining(
          'Could not send the report after 2 attempts: the last one failed: fetch failed',
        ) as string,
      },
    ]);
  });

  it('starts a failed reporter, never throwing, on options that are not an object', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const options of [null, 42, 'shop']) {
        const reporter = createReporter(options as unknown as ReporterOptions);
        expect(reporter.enabled).toBe(false);
        reporter.addResult(testResult(1));
        expect(await reporter.complete()).toMatchObject({
          status: 'failed',
          notSent: 1,
          errors: [{ message: 'options must be an object' }],
        });
      }
      expect(error).toHaveBeenCalledWith(
        '[probara] Probara reporting is off: options must be an object',
      );
    } finally {
      error.mockRestore();
    }
  });

  it('never throws from addResult', () => {
    const { reporter } = setup();

    expect(() => {
      reporter.addResult(undefined as unknown as TestResultInput);
      reporter.addResult({ identity: null } as unknown as TestResultInput);
    }).not.toThrow();
  });
});
