/**
 * Jest's watch mode (`--watch`, `--watchAll`): Jest creates a new reporter for each re-run, in the
 * same process, so each test loads the reporter afresh, as a new Jest process would, then creates
 * it once per re-run. One Probara run per watch session, never closed by the reporter.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCaseResult, fakeFileResult, fakeTest, ROOT_DIR } from '../test/support/jest-fakes.js';
import type { ProbaraJestOptions } from './options.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';

let fake: FakeProbara;
let lines: string[];

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
  lines = [];
});

afterEach(async () => {
  await fake.close();
});

const logger: Logger = {
  debug: (message) => lines.push(`debug: ${message}`),
  info: (message) => lines.push(`info: ${message}`),
  warn: (message) => lines.push(`warn: ${message}`),
  error: (message) => lines.push(`error: ${message}`),
};

/** The reporter class as a new Jest process loads it. */
async function freshProcess() {
  vi.resetModules();
  const { ProbaraJestReporter } = await import('./reporter.js');
  return ProbaraJestReporter;
}

type Reporter = Awaited<ReturnType<typeof freshProcess>>;

/** One run of Jest (a re-run in watch mode): a new reporter, and one passed test per title. */
async function jestRun(
  Reporter: Reporter,
  globalConfig: Record<string, unknown>,
  titles: readonly string[],
  options: ProbaraJestOptions = {},
): Promise<void> {
  const reporter = new Reporter(
    { rootDir: ROOT_DIR, ...globalConfig },
    {
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
      logger,
      sleep: () => Promise.resolve(),
      rootDir: ROOT_DIR,
      run: { name: 'Local', tags: ['watch'] },
      ...options,
    },
  );
  void reporter.onRunStart();
  const file = fakeTest('src/cart.test.js');
  reporter.onTestFileStart(file);
  const attempts = titles.map((title) => fakeCaseResult(30, { titles: ['cart', title] }));
  for (const attempt of attempts) reporter.onTestCaseResult(file, attempt);
  reporter.onTestFileResult(file, fakeFileResult(30, file, attempts));
  await reporter.onRunComplete();
}

/** The keys of the results of `report`. */
function keysOf(report: ReturnType<FakeProbara['reports']>[number]): string[] {
  return report.results.map((entry) => entry.automationKey ?? '');
}

/** The keys of each report, one list per report. */
function keysByReport(): string[][] {
  return fake.reports().map(keysOf);
}

function closes(): number {
  return (
    fake.requestsTo('closeRun').length +
    fake.reports().filter((report) => report.options?.close === true).length
  );
}

describe.each([{ watch: true }, { watchAll: true }])('in watch mode (%o)', (globalConfig) => {
  it('reports every re-run into the one run the first created, and never closes it', async () => {
    const Reporter = await freshProcess();
    await jestRun(Reporter, globalConfig, ['adds an item']);
    await jestRun(Reporter, globalConfig, ['adds an item', 'removes an item']);
    await jestRun(Reporter, globalConfig, ['removes an item'], { closeRun: true });

    const [run] = fake.runs();
    expect(fake.runs()).toHaveLength(1);
    expect(run).toMatchObject({ name: 'Local', state: 'open' });
    expect(fake.reports().map((report) => report.run)).toEqual([
      expect.objectContaining({ name: 'Local', tags: ['watch'] }),
      { ulid: run?.ulid },
      { ulid: run?.ulid },
    ]);
    expect(keysByReport()).toEqual([
      ['src/cart.test.js > cart adds an item'],
      ['src/cart.test.js > cart adds an item', 'src/cart.test.js > cart removes an item'],
      ['src/cart.test.js > cart removes an item'],
    ]);
    expect(closes()).toBe(0);
    expect(lines.filter((line) => line.includes('Watch mode'))).toEqual([
      `info: Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid ${run?.ulid ?? ''}`,
    ]);
    expect(lines.filter((line) => /^(warn|error):/.test(line))).toEqual([]);
  });

  it('creates the run of each project when it first gets results, then reuses it', async () => {
    const Reporter = await freshProcess();
    const options = { projects: ['WEB'] };
    await jestRun(Reporter, globalConfig, ['adds an item'], options);
    await jestRun(Reporter, globalConfig, ['WEB-3 shows the cart'], options);
    await jestRun(Reporter, globalConfig, ['adds an item', 'WEB-3 shows the cart'], options);

    const runs = fake.runs();
    expect(runs.map((run) => [run.projectId, run.state])).toEqual([
      ['SHOP', 'open'],
      ['WEB', 'open'],
    ]);
    const [shop, web] = runs;
    expect(
      fake.requests
        .filter((request) => request.route === 'report')
        .map((request) => [request.projectId, (request.body as { run: unknown }).run]),
    ).toEqual([
      ['SHOP', expect.objectContaining({ name: 'Local' })],
      ['WEB', expect.objectContaining({ name: 'Local' })],
      ['SHOP', { ulid: shop?.ulid }],
      ['WEB', { ulid: web?.ulid }],
    ]);
    expect(closes()).toBe(0);
    expect(lines.filter((line) => line.includes('Watch mode'))).toEqual([
      expect.stringContaining('every re-run reports into R-1 of SHOP'),
      expect.stringContaining('every re-run reports into R-2 of WEB'),
    ]);
    // A project the session has no run of yet is no shard of a shared run.
    expect(lines.filter((line) => /^(warn|error):/.test(line))).toEqual([]);
  });

  it('sends a re-run its closed run refused into a new run, which later re-runs reuse', async () => {
    const Reporter = await freshProcess();
    await jestRun(Reporter, globalConfig, ['adds an item']);
    const [first] = fake.runs();
    await fetch(`${fake.baseUrl}/api/v1/runs/${first?.ulid ?? ''}/close`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    await jestRun(Reporter, globalConfig, ['adds an item', 'removes an item']);
    await jestRun(Reporter, globalConfig, ['adds an item']);

    const runs = fake.runs();
    expect(runs.map((run) => run.state)).toEqual(['closed', 'open']);
    // Nothing of the refused re-run is lost.
    expect(runs[1]?.results).toHaveLength(3);
    expect(lines.filter((line) => /Watch mode|was closed/.test(line))).toEqual([
      expect.stringContaining('Watch mode: every re-run reports into R-1 of SHOP'),
      'info: The run R-1 of SHOP was closed: sent the 2 results of this re-run into a new run',
      expect.stringContaining('Watch mode: every re-run reports into R-2 of SHOP'),
    ]);
    // The close of R-1 above only: the reporter closes no run.
    expect(closes()).toBe(1);
  });

  it('sends a re-run its deleted run refused into a new run', async () => {
    const Reporter = await freshProcess();
    await jestRun(Reporter, globalConfig, ['adds an item']);
    // The run was deleted in Probara: the next report of it is refused.
    fake.fail(
      'report',
      { status: 404, body: { error: { code: 'not_found', message: 'Run not found' } } },
      { from: 2, times: 1 },
    );
    await jestRun(Reporter, globalConfig, ['removes an item']);
    await jestRun(Reporter, globalConfig, ['adds an item']);

    const runs = fake.runs();
    expect(runs.map((run) => run.results.length)).toEqual([1, 2]);
    expect(fake.reports().map((report) => report.run)).toEqual([
      expect.objectContaining({ name: 'Local' }),
      { ulid: runs[0]?.ulid },
      expect.objectContaining({ name: 'Local' }),
      { ulid: runs[1]?.ulid },
    ]);
    expect(lines).toContain(
      'info: The run R-1 of SHOP was deleted: sent the 1 result of this re-run into a new run',
    );
  });

  it('never sends again a re-run whose report was still in flight (409 with Retry-After): it may be recorded', async () => {
    const Reporter = await freshProcess();
    await jestRun(Reporter, globalConfig, ['adds an item']);
    fake.fail(
      'report',
      {
        status: 409,
        headers: { 'retry-after': '1' },
        body: { error: { code: 'conflict', message: 'A request with this key is in flight' } },
      },
      { from: 2, times: 2 },
    );
    await jestRun(Reporter, globalConfig, ['removes an item'], { maxRetries: 1 });
    await jestRun(Reporter, globalConfig, ['adds an item']);

    // The session keeps its run: no new run, and the in-flight report is never sent again.
    const [run] = fake.runs();
    expect(fake.runs()).toHaveLength(1);
    expect(fake.reports().map((report) => report.run)).toEqual([
      expect.objectContaining({ name: 'Local' }),
      { ulid: run?.ulid },
      { ulid: run?.ulid },
      { ulid: run?.ulid },
    ]);
    const retried = fake.requestsTo('report').slice(1, 3);
    expect(new Set(retried.map((request) => request.headers['idempotency-key'])).size).toBe(1);
    expect(lines.filter((line) => /into a new run|was closed|was deleted/.test(line))).toEqual([]);
    expect(lines).toContainEqual(expect.stringMatching(/^error: 1 result was not sent: /));
  });

  it('sends into a new run only the chunks of a re-run its run refused once it was closed', async () => {
    const Reporter = await freshProcess();
    await jestRun(Reporter, globalConfig, ['adds an item']);
    // The run is closed after the first chunk of the next re-run was recorded.
    fake.fail(
      'report',
      { status: 409, body: { error: { code: 'conflict', message: 'The run is closed' } } },
      { from: 3, times: 1 },
    );
    await jestRun(Reporter, globalConfig, ['adds an item', 'removes an item', 'empties'], {
      chunkSize: 1,
    });

    const runs = fake.runs();
    // Each result of the re-run is recorded once: the first chunk in R-1, the rest in R-2.
    expect(runs.map((run) => run.results.length)).toEqual([2, 2]);
    expect(fake.reports().map((report) => [report.run, keysOf(report)])).toEqual([
      [expect.objectContaining({ name: 'Local' }), ['src/cart.test.js > cart adds an item']],
      [{ ulid: runs[0]?.ulid }, ['src/cart.test.js > cart adds an item']],
      [{ ulid: runs[0]?.ulid }, ['src/cart.test.js > cart removes an item']],
      [expect.objectContaining({ name: 'Local' }), ['src/cart.test.js > cart removes an item']],
      [{ ulid: runs[1]?.ulid }, ['src/cart.test.js > cart empties']],
    ]);
    expect(lines).toContain(
      'info: The run R-1 of SHOP was closed: sent the 2 results of this re-run into a new run',
    );
  });

  it('leaves a refused re-run to the results file that keeps it, rather than send it twice', async () => {
    const Reporter = await freshProcess();
    const resultsFile = join(mkdtempSync(join(tmpdir(), 'probara-watch-')), 'results.json');
    await jestRun(Reporter, globalConfig, ['adds an item'], { resultsFile });
    fake.fail(
      'report',
      { status: 409, body: { error: { code: 'conflict', message: 'The run is closed' } } },
      { from: 2, times: 1 },
    );
    await jestRun(Reporter, globalConfig, ['removes an item'], { resultsFile });

    expect(fake.reports()).toHaveLength(2);
    expect(existsSync(resultsFile)).toBe(true);
    expect(lines).toContain(
      'info: The run R-1 of SHOP was closed: the results file keeps this re-run; the next re-run reports into a new run',
    );
  });
});

describe('without watch mode', () => {
  it('creates and closes a run for every Jest run of the process', async () => {
    const Reporter = await freshProcess();
    await jestRun(Reporter, {}, ['adds an item']);
    await jestRun(Reporter, { watch: false, watchAll: false }, ['adds an item']);

    expect(fake.runs().map((run) => run.state)).toEqual(['closed', 'closed']);
    expect(lines.filter((line) => line.includes('Watch mode'))).toEqual([]);
  });
});
