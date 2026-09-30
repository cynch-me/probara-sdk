/**
 * `runCasesOnly` in the reporter: it reads the cases of the run before Jest starts its test
 * processes, hands them to the setup file, leaves the tests the setup file skipped out of the
 * report and of its counts, and runs and reports every test, with one warning, whenever the
 * selection cannot be made.
 */
import type { Logger } from '@probara/core';
import {
  startFakeProbara,
  type FakeProbara,
  type FakeReply,
} from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakeCaseResult,
  fakeCaseStart,
  fakeFileResult,
  fakeTest,
  ROOT_DIR,
  type JestVersion,
} from '../test/support/jest-fakes.js';
import { appendLine, CHANNEL_VARIABLE, readSettings } from './channel.js';
import type { ProbaraJestOptions } from './options.js';
import { ProbaraJestReporter } from './reporter.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const RUN = '01K5ZR00000000000000000RN7';
const CART = 'src/cart.test.js';
const CASES = [
  { caseDisplayId: 'PRB-1', automationKey: `${CART} > cart adds` },
  { caseDisplayId: 'PRB-2', automationKey: null },
  { caseDisplayId: 'PRB-3', automationKey: 'src/gone.test.js > gone' },
];

function capturingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  return { logger, lines, above: () => lines.filter((line) => !line.startsWith('debug:')) };
}

let outer: string | undefined;

beforeEach(() => {
  outer = process.env[CHANNEL_VARIABLE];
  Reflect.deleteProperty(process.env, CHANNEL_VARIABLE);
});

afterEach(() => {
  if (outer === undefined) Reflect.deleteProperty(process.env, CHANNEL_VARIABLE);
  else process.env[CHANNEL_VARIABLE] = outer;
});

describe.each([29, 30] as const)('runCasesOnly on Jest %i', (version: JestVersion) => {
  let fake: FakeProbara;

  beforeEach(async () => {
    fake = await startFakeProbara({ token: TOKEN });
  });

  afterEach(async () => {
    await fake.close();
  });

  async function start(options: ProbaraJestOptions = {}, env: Record<string, string> = {}) {
    const log = capturingLogger();
    const reporter = new ProbaraJestReporter(
      { rootDir: ROOT_DIR },
      {
        env: {
          PROBARA_API_TOKEN: TOKEN,
          PROBARA_PROJECT: 'PRB',
          PROBARA_BASE_URL: fake.baseUrl,
          PROBARA_RUN_ULID: RUN,
          ...env,
        },
        logger: log.logger,
        sleep: () => Promise.resolve(),
        rootDir: ROOT_DIR,
        runCasesOnly: true,
        ...options,
      },
    );
    await reporter.onRunStart();
    return { reporter, log, channel: process.env[CHANNEL_VARIABLE] ?? '' };
  }

  /** What the setup file of a test process writes: that it runs, and the tests it skipped. */
  function setUp(channel: string, file: string, deselected?: string[][]) {
    // Never the working directory: the reporter must have opened its channel.
    expect(channel).not.toBe('');
    appendLine(channel, { type: 'setup', file });
    if (deselected !== undefined)
      appendLine(channel, { type: 'selection', file, applied: true, deselected });
  }

  /** One file of Jest's run: its tests that ran (`passed`), then the file result with every test. */
  function runFile(
    reporter: ProbaraJestReporter,
    path: string,
    tests: { titles: string[]; status: 'passed' | 'failed' | 'pending' | 'todo' }[],
  ) {
    const file = fakeTest(path);
    reporter.onTestFileStart(file);
    const cases = tests.map(({ titles, status }) =>
      fakeCaseResult(version, {
        titles,
        status,
        ...(status === 'pending' ? { duration: null } : {}),
      }),
    );
    // Like Jest: a test that ran starts and ends, a todo only ends, a skipped test does neither.
    tests.forEach(({ titles, status }, index) => {
      if (status === 'pending') return;
      if (status !== 'todo') {
        reporter.onTestCaseStart(
          file,
          fakeCaseStart(titles, Date.parse('2026-09-30T10:00:01.000Z')),
        );
      }
      const result = cases[index];
      if (result !== undefined) reporter.onTestCaseResult(file, result);
    });
    reporter.onTestFileResult(file, fakeFileResult(version, file, cases));
    return file;
  }

  function sentKeys(): string[] {
    return fake
      .reports()
      .flatMap((report) => report.results)
      .map((entry) => `${entry.automationKey ?? ''} ${entry.status}`);
  }

  it("hands the setup file the run's cases, and how the reporter keys a test, before any test runs", async () => {
    fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: CASES });
    const { reporter, channel } = await start();

    expect(fake.requestsTo('caseKeys').map((request) => request.runUlid)).toEqual([RUN]);
    expect(readSettings(channel)).toEqual({
      captureOutput: false,
      selection: {
        run: RUN,
        keys: [`${CART} > cart adds`, 'src/gone.test.js > gone'],
        caseIds: ['PRB-1', 'PRB-2', 'PRB-3'],
        projectCodes: ['PRB'],
        keyIncludesFile: true,
        rootDir: ROOT_DIR,
      },
    });
    await reporter.onRunComplete();
  });

  it('leaves the tests the selection skipped out of the report and its counts, and says how many ran', async () => {
    fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: CASES });
    const { reporter, log, channel } = await start({ keyIncludesFile: true });
    const cart = `${ROOT_DIR}/${CART}`;
    const wishlist = `${ROOT_DIR}/src/wishlist.test.js`;
    setUp(channel, cart, [
      ['cart', 'removes'],
      ['cart', 'saves for later'],
    ]);
    // Every test of this file was skipped already: the setup file's hook never ran.
    setUp(channel, wishlist);

    runFile(reporter, CART, [
      { titles: ['cart', 'adds'], status: 'passed' },
      { titles: ['cart', 'PRB-2 pays'], status: 'failed' },
      { titles: ['cart', 'removes'], status: 'pending' },
      { titles: ['cart', 'saves for later'], status: 'todo' },
    ]);
    runFile(reporter, 'src/wishlist.test.js', [
      { titles: ['wishlist', 'shares'], status: 'pending' },
      { titles: ['wishlist', 'PRB-2 lists'], status: 'pending' },
    ]);
    await reporter.onRunComplete();

    expect(sentKeys()).toEqual([
      `${CART} > cart adds passed`,
      `${CART} > cart pays failed`,
      // A case of the run, skipped by the test itself: reported as skipped.
      'src/wishlist.test.js > wishlist lists skipped',
    ]);
    expect(log.above()).toEqual(
      expect.arrayContaining([
        `info: Ran only the tests of run ${RUN}: 3 of 6 tests match its cases; 3 skipped and not reported`,
        'info: Sending 3 results of 3 tests (1 passed, 1 failed, 1 skipped, 0 blocked)',
      ]),
    );
    expect(log.above().filter((line) => line.startsWith('warn:'))).toEqual([]);
  });

  it('reports every test of a file the setup file could not skip tests in, warns once per reason, and counts none of them', async () => {
    fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: CASES });
    const { reporter, log, channel } = await start();
    setUp(channel, `${ROOT_DIR}/${CART}`, [['cart', 'removes']]);
    const failures = [
      ['a', 'no-circus'],
      ['b', 'no-circus'],
      ['c', 'no-hook'],
    ] as const;
    for (const [name, reason] of failures) {
      const file = `${ROOT_DIR}/src/${name}.test.js`;
      appendLine(channel, { type: 'setup', file });
      appendLine(channel, { type: 'selection', file, applied: false, reason });
    }

    runFile(reporter, CART, [
      { titles: ['cart', 'adds'], status: 'passed' },
      { titles: ['cart', 'removes'], status: 'pending' },
    ]);
    runFile(reporter, 'src/a.test.js', [
      { titles: ['a', 'runs'], status: 'passed' },
      { titles: ['a', 'waits'], status: 'pending' },
    ]);
    runFile(reporter, 'src/b.test.js', [{ titles: ['b', 'runs'], status: 'passed' }]);
    runFile(reporter, 'src/c.test.js', [{ titles: ['c', 'runs'], status: 'failed' }]);
    await reporter.onRunComplete();

    expect(sentKeys()).toEqual([
      `${CART} > cart adds passed`,
      'src/a.test.js > a runs passed',
      'src/a.test.js > a waits skipped',
      'src/b.test.js > b runs passed',
      'src/c.test.js > c runs failed',
    ]);
    const warning = (reason: string, file: string) =>
      `warn: runCasesOnly: the setup file could not skip the tests of a file that match no case of the run (${reason}). Every test of such a file runs and is reported (first seen in ${file}; repeats are logged at debug)`;
    expect(log.above().filter((line) => line.startsWith('warn:'))).toEqual([
      warning("the test runner is not jest-circus, Jest's default", 'src/a.test.js'),
      warning('no beforeAll hook of Jest to register', 'src/c.test.js'),
    ]);
    expect(log.above()).toContain(
      `info: Ran only the tests of run ${RUN}: 1 of 2 tests match its cases; 1 skipped and not reported`,
    );
  });

  it('decides with the Jest project name whether a test whose names hold {displayName} is reported', async () => {
    fake.seedRun({
      projectId: 'PRB',
      ulid: RUN,
      cases: [{ caseDisplayId: 'PRB-7', automationKey: `${CART} > cart shop adds` }],
    });
    const { reporter, log, channel } = await start();
    // The setup file keeps them: it cannot know the project's name.
    setUp(channel, `${ROOT_DIR}/${CART}`, []);
    const file = fakeTest(CART, 'shop');
    reporter.onTestFileStart(file);
    const cases = [
      fakeCaseResult(version, { titles: ['cart', '{displayName} adds'], status: 'passed' }),
      fakeCaseResult(version, { titles: ['cart', '{displayName} removes'], status: 'failed' }),
    ];
    for (const result of cases) {
      reporter.onTestCaseStart(file, fakeCaseStart([...result.ancestorTitles, result.title], 0));
      reporter.onTestCaseResult(file, result);
    }
    reporter.onTestFileResult(file, {
      ...fakeFileResult(version, file, cases),
      displayName: { name: 'shop', color: 'blue' },
    });
    await reporter.onRunComplete();

    expect(sentKeys()).toEqual([`${CART} > cart shop adds passed`]);
    expect(log.above()).toContain(
      `info: Ran only the tests of run ${RUN}: 1 of 2 tests match its cases; 1 skipped and not reported`,
    );
  });

  it('warns once when no test matches the cases of the run, and sends nothing', async () => {
    fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: [CASES[2] ?? CASES[0]] as never });
    const { reporter, log, channel } = await start();
    const cart = `${ROOT_DIR}/${CART}`;
    setUp(channel, cart, [
      ['cart', 'adds'],
      ['cart', 'removes'],
    ]);
    runFile(reporter, CART, [
      { titles: ['cart', 'adds'], status: 'pending' },
      { titles: ['cart', 'removes'], status: 'pending' },
    ]);
    await reporter.onRunComplete();

    expect(sentKeys()).toEqual([]);
    expect(log.above().filter((line) => /Ran only|No test|Sending/.test(line))).toEqual([
      `warn: No test matches the cases of the run ${RUN}: every test was skipped, and none is reported`,
    ]);
  });

  it('reads the cases again for every run of a watch session', async () => {
    fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: CASES });
    for (let rerun = 0; rerun < 2; rerun += 1) {
      const { reporter } = await start();
      await reporter.onRunComplete();
    }
    expect(fake.requestsTo('caseKeys')).toHaveLength(2);
  });

  describe.each<{ name: string; reply?: FakeReply; reason: RegExp }>([
    { name: 'an unknown run (404)', reason: /404|not found/i },
    { name: 'a refused token (401)', reply: { status: 401 }, reason: /401|unauthorized/i },
    { name: 'a forbidden run (403)', reply: { status: 403 }, reason: /403|forbidden/i },
    {
      name: 'an invalid response',
      reply: { status: 200, body: { items: 'nope' } },
      reason: /./,
    },
  ])('when the cases cannot be read: $name', ({ reply, reason }) => {
    it('runs and reports every test, with one warning', async () => {
      if (reply !== undefined) {
        fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: CASES });
        fake.fail('caseKeys', reply);
      }
      const { reporter, log, channel } = await start();
      expect(readSettings(channel)).toEqual({ captureOutput: false });
      setUp(channel, `${ROOT_DIR}/${CART}`);
      runFile(reporter, CART, [
        { titles: ['cart', 'adds'], status: 'passed' },
        { titles: ['cart', 'removes'], status: 'pending' },
      ]);
      await reporter.onRunComplete();

      expect(sentKeys()).toEqual([`${CART} > cart adds passed`, `${CART} > cart removes skipped`]);
      const warnings = log.above().filter((line) => line.startsWith('warn:'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(
        new RegExp(
          `^warn: runCasesOnly: could not read the cases of the run ${RUN} \\(.+\\)\\. Every test runs and is reported$`,
        ),
      );
      expect(warnings[0]).toMatch(reason);
      expect(log.lines.join('\n')).not.toContain(TOKEN);
      expect(log.above().some((line) => line.includes('Ran only'))).toBe(false);
    });
  });

  it('runs and reports every test, with one warning, without the run to select from', async () => {
    const { reporter, log, channel } = await start({}, { PROBARA_RUN_ULID: '' });
    expect(fake.requestsTo('caseKeys')).toEqual([]);
    expect(readSettings(channel)).toEqual({ captureOutput: false });
    setUp(channel, `${ROOT_DIR}/${CART}`);
    runFile(reporter, CART, [{ titles: ['cart', 'removes'], status: 'pending' }]);
    await reporter.onRunComplete();

    expect(sentKeys()).toEqual([`${CART} > cart removes skipped`]);
    expect(log.above().filter((line) => line.startsWith('warn:'))).toEqual([
      'warn: runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported',
    ]);
  });

  it('reports every test of a file the setup file did not run in, with one warning', async () => {
    fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: CASES });
    const { reporter, log } = await start();
    runFile(reporter, CART, [
      { titles: ['cart', 'adds'], status: 'passed' },
      { titles: ['cart', 'removes'], status: 'passed' },
    ]);
    runFile(reporter, 'src/other.test.js', [{ titles: ['other', 'runs'], status: 'passed' }]);
    await reporter.onRunComplete();

    expect(sentKeys()).toEqual([
      `${CART} > cart adds passed`,
      `${CART} > cart removes passed`,
      'src/other.test.js > other runs passed',
    ]);
    expect(log.above().filter((line) => line.startsWith('warn:'))).toEqual([
      "warn: runCasesOnly needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config. Every test of a file without it runs and is reported (first seen in src/cart.test.js; repeats are logged at debug)",
    ]);
    expect(log.above().some((line) => line.includes('Ran only'))).toBe(false);
  });

  it('reads no cases, and selects nothing, without runCasesOnly', async () => {
    fake.seedRun({ projectId: 'PRB', ulid: RUN, cases: CASES });
    const { reporter, channel } = await start({ runCasesOnly: false });
    expect(fake.requestsTo('caseKeys')).toEqual([]);
    expect(readSettings(channel)).toEqual({ captureOutput: false });
    await reporter.onRunComplete();
  });
});
