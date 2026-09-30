/**
 * Jest's watch mode (`--watch`, `--watchAll`): Jest creates a new reporter for each re-run, in the
 * same process, so each test loads the reporter afresh, as a new Jest process would, then creates
 * it once per re-run. One Probara run per watch session, never closed by the reporter.
 */
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
  reporter.onRunStart();
  const file = fakeTest('src/cart.test.js');
  reporter.onTestFileStart(file);
  const attempts = titles.map((title) => fakeCaseResult(30, { titles: ['cart', title] }));
  for (const attempt of attempts) reporter.onTestCaseResult(file, attempt);
  reporter.onTestFileResult(file, fakeFileResult(30, file, attempts));
  await reporter.onRunComplete();
}

/** The keys of each report, one list per report. */
function keysByReport(): string[][] {
  return fake.reports().map((report) => report.results.map((entry) => entry.automationKey ?? ''));
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
  });

  it('creates a new run at the next re-run when its run was closed meanwhile', async () => {
    const Reporter = await freshProcess();
    await jestRun(Reporter, globalConfig, ['adds an item']);
    const [first] = fake.runs();
    await fetch(`${fake.baseUrl}/api/v1/runs/${first?.ulid ?? ''}/close`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    await jestRun(Reporter, globalConfig, ['adds an item']);
    await jestRun(Reporter, globalConfig, ['adds an item']);
    await jestRun(Reporter, globalConfig, ['adds an item']);

    const runs = fake.runs();
    expect(runs.map((run) => run.state)).toEqual(['closed', 'open']);
    expect(runs[1]?.results).toHaveLength(2);
    expect(lines).toContain(
      'info: The run R-1 of SHOP was closed: the next re-run reports into a new run',
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
