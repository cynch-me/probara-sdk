import type { Logger } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeConfig, fakeResult, fakeTest } from '../test/support/playwright-fakes.js';
import ProbaraPlaywrightReporter, { type ProbaraPlaywrightOptions } from './index.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

afterEach(() => {
  vi.restoreAllMocks();
});

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

async function runEmpty(options: ProbaraPlaywrightOptions) {
  const reporter = new ProbaraPlaywrightReporter(options);
  reporter.onBegin(fakeConfig());
  return reporter.onEnd();
}

describe('ProbaraPlaywrightReporter lifecycle', () => {
  it('prints nothing of its own to stdio, so Playwright keeps its terminal reporter', () => {
    expect(new ProbaraPlaywrightReporter().printsToStdio()).toBe(false);
  });

  it('stays quiet when reporting is not configured', async () => {
    const log = capturingLogger();
    await expect(runEmpty({ env: {}, logger: log.logger })).resolves.toBeUndefined();
    expect(log.above()).toEqual([]);
  });

  it('logs each configuration problem on stderr, never on stdout, and never throws', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runEmpty({ env: { PROBARA_API_TOKEN: TOKEN } })).resolves.toBeUndefined();

    expect(stderr.mock.calls.flat()).toEqual([
      expect.stringMatching(/^\[probara\] Probara reporting is off: .*PROBARA_PROJECT/),
    ]);
    expect(stdout).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(TOKEN);
  });

  it('turns reporting off on a PROBARA_CAPTURE_OUTPUT that is not a boolean, naming it', async () => {
    const log = capturingLogger();
    await runEmpty({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_CAPTURE_OUTPUT: 'verbose' },
      logger: log.logger,
    });
    expect(log.above()).toEqual([
      'error: Probara reporting is off: PROBARA_CAPTURE_OUTPUT must be true or false',
    ]);
  });

  it('turns reporting off on a captureOutput option that is not a boolean', async () => {
    const log = capturingLogger();
    await runEmpty({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB' },
      captureOutput: 'yes' as unknown as boolean,
      logger: log.logger,
    });
    expect(log.above()).toEqual([
      'error: Probara reporting is off: captureOutput must be true or false',
    ]);
  });

  it('never throws into Playwright, even on options that are not an object', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = new ProbaraPlaywrightReporter(null as unknown as ProbaraPlaywrightOptions);
    expect(() => {
      reporter.onBegin(fakeConfig());
    }).not.toThrow();
    await expect(reporter.onEnd()).resolves.toBeUndefined();
  });

  it('logs one redacted error line when it cannot start, and reports nothing', async () => {
    const log = capturingLogger();
    const reporter = new ProbaraPlaywrightReporter({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB' },
      logger: log.logger,
    });
    const config = fakeConfig();
    Object.defineProperty(config, 'rootDir', {
      get: () => {
        throw new Error(`no root for ${TOKEN}`);
      },
    });

    expect(() => {
      reporter.onBegin(config);
    }).not.toThrow();
    reporter.onTestEnd(fakeTest(), fakeResult());
    await reporter.onEnd();

    expect(log.above()).toEqual([
      'error: Probara reporting is off: the reporter could not start: no root for [redacted]',
    ]);
  });

  it('ends quietly when Playwright never began the run', async () => {
    await expect(new ProbaraPlaywrightReporter().onEnd()).resolves.toBeUndefined();
  });
});

describe('ProbaraPlaywrightReporter reporting a run', () => {
  let fake: FakeProbara;

  beforeEach(async () => {
    fake = await startFakeProbara({ token: TOKEN });
  });

  afterEach(async () => {
    await fake.close();
  });

  function start(options: ProbaraPlaywrightOptions = {}) {
    const log = capturingLogger();
    const reporter = new ProbaraPlaywrightReporter({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_BASE_URL: fake.baseUrl },
      logger: log.logger,
      sleep: () => Promise.resolve(),
      ...options,
    });
    reporter.onBegin(fakeConfig());
    return { reporter, log };
  }

  it('sends every attempt as its own result, in attempt order, into one run it closes', async () => {
    const { reporter } = start();
    const flaky = fakeTest({ titles: ['login', 'is flaky'] });
    reporter.onTestEnd(
      flaky,
      fakeResult({ retry: 0, status: 'failed', errors: [{ message: 'boom' }] }),
    );
    reporter.onTestEnd(flaky, fakeResult({ retry: 1, status: 'passed' }));
    reporter.onTestEnd(fakeTest({ titles: ['login', 'logs in'] }), fakeResult());
    await reporter.onEnd();

    const [report] = fake.reports();
    expect(fake.reports()).toHaveLength(1);
    expect(
      report?.results.map((entry) => [entry.automationKey, entry.status, entry.notes]),
    ).toEqual([
      ['login.spec.ts > login > is flaky [project=chromium]', 'failed', 'boom'],
      ['login.spec.ts > login > is flaky [project=chromium]', 'passed', undefined],
      ['login.spec.ts > login > logs in [project=chromium]', 'passed', undefined],
    ]);
    expect(report?.options?.close).toBe(true);
    expect(fake.runs()[0]?.state).toBe('closed');
  });

  it('names itself first in the User-Agent', async () => {
    const { reporter } = start();
    reporter.onTestEnd(fakeTest(), fakeResult());
    await reporter.onEnd();

    expect(fake.requestsTo('report')[0]?.headers['user-agent']).toMatch(
      /^probara-playwright-reporter\/0\.1\.0 probara-core\//,
    );
  });

  it('takes the reporter options over the PROBARA_* variables', async () => {
    const { reporter } = start({
      projectId: 'WEB',
      baseUrl: fake.baseUrl,
      env: {
        PROBARA_API_TOKEN: TOKEN,
        PROBARA_PROJECT: 'PRB',
        PROBARA_BASE_URL: 'http://127.0.0.1:9',
      },
    });
    reporter.onTestEnd(fakeTest({ titles: ['WEB-5 PRB-6 logs in'] }), fakeResult());
    await reporter.onEnd();

    const [request] = fake.requestsTo('report');
    expect(request?.projectId).toBe('WEB');
    expect(fake.reports()[0]?.results[0]).toMatchObject({
      caseDisplayId: 'WEB-5',
      automationKey: 'login.spec.ts > PRB-6 logs in [project=chromium]',
    });
  });

  it('sends a test that links several cases once per case, with the same key', async () => {
    const { reporter } = start();
    reporter.onTestEnd(fakeTest({ titles: ['PRB-12 PRB-13 logs in'] }), fakeResult());
    await reporter.onEnd();

    expect(
      fake.reports()[0]?.results.map((entry) => [entry.caseDisplayId, entry.automationKey]),
    ).toEqual([
      ['PRB-12', 'login.spec.ts > logs in [project=chromium]'],
      ['PRB-13', 'login.spec.ts > logs in [project=chromium]'],
    ]);
  });

  it("applies core's status mapping and filter", async () => {
    const { reporter } = start({ statusMapping: { failed: 'blocked' }, statusFilter: ['skipped'] });
    reporter.onTestEnd(fakeTest({ titles: ['fails'] }), fakeResult({ status: 'failed' }));
    reporter.onTestEnd(
      fakeTest({ titles: ['is skipped'], expectedStatus: 'skipped' }),
      fakeResult({ status: 'skipped' }),
    );
    await reporter.onEnd();

    expect(fake.reports()[0]?.results.map((entry) => entry.status)).toEqual(['blocked']);
  });

  it('logs the counts of what it handed over, then core logs the run link', async () => {
    const { reporter, log } = start();
    const flaky = fakeTest({ titles: ['is flaky'] });
    reporter.onTestEnd(flaky, fakeResult({ retry: 0, status: 'failed' }));
    reporter.onTestEnd(flaky, fakeResult({ retry: 1, status: 'passed' }));
    reporter.onTestEnd(
      fakeTest({ titles: ['is skipped'], expectedStatus: 'skipped' }),
      fakeResult({ status: 'skipped' }),
    );
    await reporter.onEnd();

    expect(log.above()).toEqual([
      'info: Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped)',
      `info: Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): ${fake.baseUrl}/projects/PRB/runs/R-1`,
    ]);
  });

  it('uploads the attachments of each attempt to its own result', async () => {
    const { reporter } = start();
    const test = fakeTest({ titles: ['is flaky'] });
    reporter.onTestEnd(
      test,
      fakeResult({
        retry: 0,
        status: 'failed',
        attachments: [{ name: 'first', contentType: 'text/plain', body: Buffer.from('attempt 1') }],
      }),
    );
    reporter.onTestEnd(
      test,
      fakeResult({
        retry: 1,
        attachments: [
          { name: 'second', contentType: 'text/plain', body: Buffer.from('attempt 2') },
        ],
      }),
    );
    await reporter.onEnd();

    const staged = fake.requestsTo('stage').map((request) => [request.resultUlid, request.body]);
    expect(staged).toEqual([
      [expect.any(String), [{ name: 'first.txt', type: 'text/plain', size: 9 }]],
      [expect.any(String), [{ name: 'second.txt', type: 'text/plain', size: 9 }]],
    ]);
    expect(staged[0]?.[0]).not.toBe(staged[1]?.[0]);
  });

  it('attaches stdout and stderr with PROBARA_CAPTURE_OUTPUT', async () => {
    const { reporter } = start({
      env: {
        PROBARA_API_TOKEN: TOKEN,
        PROBARA_PROJECT: 'PRB',
        PROBARA_BASE_URL: fake.baseUrl,
        PROBARA_CAPTURE_OUTPUT: 'true',
      },
    });
    reporter.onTestEnd(fakeTest(), fakeResult({ stdout: ['hello\n'], stderr: ['oops\n'] }));
    await reporter.onEnd();

    expect(fake.stagedFiles()).toEqual([
      { name: 'stdout.log', type: 'text/plain', size: 6 },
      { name: 'stderr.log', type: 'text/plain', size: 5 },
    ]);
  });

  it('attaches no output by default, and none when the option turns it off', async () => {
    const off = start({
      captureOutput: false,
      env: {
        PROBARA_API_TOKEN: TOKEN,
        PROBARA_PROJECT: 'PRB',
        PROBARA_BASE_URL: fake.baseUrl,
        PROBARA_CAPTURE_OUTPUT: 'true',
      },
    });
    off.reporter.onTestEnd(fakeTest(), fakeResult({ stdout: ['hello\n'] }));
    await off.reporter.onEnd();
    const byDefault = start();
    byDefault.reporter.onTestEnd(fakeTest(), fakeResult({ stdout: ['hello\n'] }));
    await byDefault.reporter.onEnd();

    expect(fake.requestsTo('report')).toHaveLength(2);
    expect(fake.stagedFiles()).toEqual([]);
  });

  it('never changes the outcome of the Playwright run when reporting fails', async () => {
    fake.fail('report', { status: 422 });
    const { reporter, log } = start();
    reporter.onTestEnd(fakeTest(), fakeResult());

    await expect(reporter.onEnd()).resolves.toBeUndefined();
    expect(log.above().some((line) => line.startsWith('error: 1 result was not sent'))).toBe(true);
  });

  it('logs one redacted error line for an attempt it cannot translate, and sends the others', async () => {
    const { reporter, log } = start();
    const broken = fakeTest();
    broken.titlePath = () => {
      throw new Error(`broken title for ${TOKEN}`);
    };
    reporter.onTestEnd(broken, fakeResult());
    reporter.onTestEnd(fakeTest(), fakeResult());
    await reporter.onEnd();

    expect(fake.reports()[0]?.results).toHaveLength(1);
    expect(log.above()[0]).toBe(
      'error: Could not report an attempt of "logs in": broken title for [redacted]',
    );
  });

  it('sends nothing, and never throws, for results after the run ended', async () => {
    const { reporter } = start();
    await reporter.onEnd();
    expect(() => {
      reporter.onTestEnd(fakeTest(), fakeResult());
    }).not.toThrow();
    expect(fake.requestsTo('report')).toHaveLength(0);
  });
});
