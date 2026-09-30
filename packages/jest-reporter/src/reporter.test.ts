import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Reporter } from '@jest/reporters';
import type { Logger } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeCaseResult,
  fakeCaseStart,
  fakeFileResult,
  fakeTest,
  ROOT_DIR,
  type JestVersion,
} from '../test/support/jest-fakes.js';
import type { ProbaraJestOptions } from './options.js';
import { ProbaraJestReporter } from './reporter.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const GLOBAL_CONFIG = { rootDir: ROOT_DIR };

const at = (iso: string) => Date.parse(iso);

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

function create(options: ProbaraJestOptions) {
  return new ProbaraJestReporter(GLOBAL_CONFIG, options);
}

async function runEmpty(options: ProbaraJestOptions) {
  const reporter = create(options);
  void reporter.onRunStart();
  await reporter.onRunComplete();
  return reporter;
}

describe('ProbaraJestReporter lifecycle', () => {
  it('is a Jest reporter', () => {
    const reporter: Reporter = create({ env: {} });
    expect(typeof reporter.onRunComplete).toBe('function');
  });

  it('stays quiet when reporting is not configured, and never fails the run', async () => {
    const log = capturingLogger();
    const reporter = await runEmpty({ env: {}, logger: log.logger });
    expect(log.above()).toEqual([]);
    expect(reporter.getLastError()).toBeUndefined();
  });

  it('logs each configuration problem on stderr, never on stdout, and never throws', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runEmpty({ env: { PROBARA_API_TOKEN: TOKEN } })).resolves.toBeDefined();

    expect(stderr.mock.calls.flat()).toEqual([
      expect.stringMatching(/^\[probara\] Probara reporting is off: .*PROBARA_PROJECT/),
    ]);
    expect(stdout).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(TOKEN);
  });

  it('turns reporting off on a keyIncludesFile that is not a boolean, naming it', async () => {
    const log = capturingLogger();
    await runEmpty({
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_KEY_INCLUDES_FILE: 'maybe' },
      logger: log.logger,
    });
    expect(log.above()).toEqual([
      'error: Probara reporting is off: PROBARA_KEY_INCLUDES_FILE must be true or false',
    ]);
  });

  it('warns about each unknown option, and reports all the same', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const log = capturingLogger();
      const reporter = create({
        env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_BASE_URL: fake.baseUrl },
        logger: log.logger,
        rootDir: ROOT_DIR,
        projectID: 'PRB',
      } as ProbaraJestOptions);
      void reporter.onRunStart();
      reporter.onTestCaseResult(fakeTest(), fakeCaseResult(30));
      await reporter.onRunComplete();

      expect(log.above()[0]).toBe(
        'warn: Ignored the unknown option "projectID" of @probara/jest-reporter',
      );
      expect(fake.reports().flatMap((report) => report.results)).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  it('never throws into Jest, even on options that are not an object', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = create(null as unknown as ProbaraJestOptions);
    const test = fakeTest();
    expect(() => {
      void reporter.onRunStart();
      reporter.onTestFileStart(test);
      reporter.onTestCaseStart(
        test,
        fakeCaseStart(['login', 'logs in'], at('2026-09-30T10:00:01.000Z')),
      );
      reporter.onTestCaseResult(test, fakeCaseResult(30));
      reporter.onTestFileResult(test, fakeFileResult(30, test, [fakeCaseResult(30)]));
    }).not.toThrow();
    await expect(reporter.onRunComplete()).resolves.toBeUndefined();
    expect(reporter.getLastError()).toBeUndefined();
  });

  it('logs one redacted error line when it cannot start, and reports nothing', async () => {
    const log = capturingLogger();
    const options: ProbaraJestOptions = {
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB' },
      logger: log.logger,
    };
    Object.defineProperty(options, 'projectId', {
      enumerable: true,
      get: () => {
        throw new Error(`no project for ${TOKEN}`);
      },
    });
    const reporter = create(options);
    const test = fakeTest();
    void reporter.onRunStart();
    reporter.onTestCaseResult(test, fakeCaseResult(30));
    await reporter.onRunComplete();

    expect(log.above()).toEqual([
      'error: Probara reporting is off: the reporter could not start: no project for [redacted]',
    ]);
  });

  it('ends quietly when Jest never started the run', async () => {
    await expect(create({ env: {} }).onRunComplete()).resolves.toBeUndefined();
  });
});

describe('ProbaraJestReporter with a results file', () => {
  it('writes every attempt to the results file while reporting is off, and logs no sending line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'probara-jest-results-'));
    try {
      const path = join(dir, 'results.json');
      const log = capturingLogger();
      const reporter = create({
        env: { PROBARA_ENABLED: 'false', PROBARA_PROJECT: 'PRB', PROBARA_RESULTS_FILE: path },
        logger: log.logger,
        rootDir: ROOT_DIR,
      });
      const test = fakeTest();
      void reporter.onRunStart();
      reporter.onTestCaseResult(
        test,
        fakeCaseResult(29, { titles: ['PRB-7 logs in'], status: 'failed' }),
      );
      await reporter.onRunComplete();

      const file = JSON.parse(await readFile(path, 'utf8')) as {
        project: string;
        results: { caseDisplayId?: string; status: string }[];
      };
      expect(file.project).toBe('PRB');
      expect(file.results).toEqual([
        expect.objectContaining({ caseDisplayId: 'PRB-7', status: 'failed' }),
      ]);
      expect(log.lines).not.toContainEqual(expect.stringContaining('Sending'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.each([29, 30] as const)(
  'ProbaraJestReporter reporting a Jest %i run',
  (version: JestVersion) => {
    let fake: FakeProbara;

    beforeEach(async () => {
      fake = await startFakeProbara({ token: TOKEN });
    });

    afterEach(async () => {
      await fake.close();
    });

    function start(options: ProbaraJestOptions = {}) {
      const log = capturingLogger();
      const reporter = create({
        env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_BASE_URL: fake.baseUrl },
        logger: log.logger,
        sleep: () => Promise.resolve(),
        rootDir: ROOT_DIR,
        ...options,
      });
      void reporter.onRunStart();
      return { reporter, log };
    }

    function results() {
      return fake.reports().flatMap((report) => report.results);
    }

    function sent() {
      return fake
        .reports()
        .flatMap((report) =>
          report.results.map((entry) => [entry.automationKey, entry.status, entry.notes ?? null]),
        );
    }

    it('sends every attempt of a retried test as its own result, in order, into one run it closes', async () => {
      const { reporter } = start();
      const test = fakeTest();
      const flaky = ['login', 'is flaky'];
      const [first, retry] = [at('2026-09-30T10:00:01.000Z'), at('2026-09-30T10:00:02.500Z')];
      reporter.onTestFileStart(test);
      reporter.onTestCaseStart(test, fakeCaseStart(flaky, first));
      reporter.onTestCaseResult(
        test,
        fakeCaseResult(version, {
          titles: flaky,
          status: 'failed',
          failureMessages: ['Error: boom'],
          startedAt: first,
        }),
      );
      reporter.onTestCaseStart(test, fakeCaseStart(flaky, retry));
      const passed = fakeCaseResult(version, { titles: flaky, invocations: 2, startedAt: retry });
      reporter.onTestCaseResult(test, passed);
      reporter.onTestFileResult(test, fakeFileResult(version, test, [passed]));
      await reporter.onRunComplete();

      expect(fake.reports()).toHaveLength(1);
      expect(sent()).toEqual([
        ['src/login.test.js > login is flaky', 'failed', 'Error: boom'],
        ['src/login.test.js > login is flaky', 'passed', null],
      ]);
      expect(results().map((entry) => entry.executedAt)).toEqual([
        '2026-09-30T10:00:01.000Z',
        '2026-09-30T10:00:02.500Z',
      ]);
      expect(fake.reports()[0]?.options?.close).toBe(true);
      expect(fake.runs()[0]?.state).toBe('closed');
    });

    it('sends the skipped tests of each file once, as skipped, and a todo as skipped with a note', async () => {
      const { reporter } = start();
      const test = fakeTest();
      const ran = fakeCaseResult(version, { titles: ['login', 'logs in'] });
      const todo = fakeCaseResult(version, {
        titles: ['login', 'remembers me'],
        status: 'todo',
        duration: null,
      });
      const skipped = (title: string) =>
        fakeCaseResult(version, { titles: ['login', title], status: 'pending', duration: null });
      reporter.onTestFileStart(test);
      reporter.onTestCaseResult(test, ran);
      reporter.onTestCaseResult(test, todo);
      reporter.onTestFileResult(
        test,
        fakeFileResult(version, test, [
          ran,
          skipped('supports SSO'),
          todo,
          skipped('supports SSO'),
        ]),
      );
      await reporter.onRunComplete();

      expect(sent()).toEqual([
        ['src/login.test.js > login logs in', 'passed', null],
        ['src/login.test.js > login remembers me', 'skipped', 'Todo'],
        ['src/login.test.js > login supports SSO', 'skipped', null],
        ['src/login.test.js > login supports SSO', 'skipped', null],
      ]);
    });

    it('sends when each attempt started, pairing the starts of files that run side by side', async () => {
      const { reporter } = start();
      const login = fakeTest('login.test.js');
      const cart = fakeTest('cart.test.js');
      reporter.onTestFileStart(login);
      reporter.onTestFileStart(cart);
      reporter.onTestCaseStart(login, fakeCaseStart(['a'], at('2026-09-30T10:00:01.000Z')));
      reporter.onTestCaseStart(cart, fakeCaseStart(['a'], at('2026-09-30T10:00:02.000Z')));
      reporter.onTestCaseResult(
        cart,
        fakeCaseResult(version, { titles: ['a'], startedAt: at('2026-09-30T10:00:02.000Z') }),
      );
      reporter.onTestCaseStart(login, fakeCaseStart(['a'], at('2026-09-30T10:00:03.000Z')));
      reporter.onTestCaseResult(
        login,
        fakeCaseResult(version, { titles: ['a'], startedAt: at('2026-09-30T10:00:01.000Z') }),
      );
      reporter.onTestCaseResult(
        login,
        fakeCaseResult(version, {
          titles: ['a'],
          invocations: 2,
          startedAt: at('2026-09-30T10:00:03.000Z'),
        }),
      );
      await reporter.onRunComplete();

      expect(
        fake
          .reports()
          .flatMap((report) =>
            report.results.map((entry) => [entry.automationKey, entry.executedAt]),
          ),
      ).toEqual([
        ['cart.test.js > a', '2026-09-30T10:00:02.000Z'],
        ['login.test.js > a', '2026-09-30T10:00:01.000Z'],
        ['login.test.js > a', '2026-09-30T10:00:03.000Z'],
      ]);
    });

    it('warns about a test file Jest could not run, naming it, and reports nothing of it', async () => {
      const { reporter, log } = start();
      const broken = fakeTest('src/broken.test.js');
      reporter.onTestFileStart(broken);
      reporter.onTestFileResult(
        broken,
        fakeFileResult(version, broken, [], {
          testExecError: { message: 'SyntaxError: Unexpected token (1:28)\n  > 1 | const x = ;' },
        }),
      );
      await reporter.onRunComplete();

      expect(fake.reports()).toEqual([]);
      expect(log.above()).toEqual([
        'warn: Could not report src/broken.test.js: Jest could not run it (SyntaxError: Unexpected token (1:28))',
      ]);
    });

    it('takes the reason of a file Jest could not run from its stack when it has no message', async () => {
      const { reporter, log } = start();
      const broken = fakeTest('src/broken.test.js');
      reporter.onTestFileStart(broken);
      reporter.onTestFileResult(
        broken,
        fakeFileResult(version, broken, [], {
          testExecError: {
            message: '',
            stack: "Error: Cannot find module './missing'\n    at Object.<anonymous>",
          },
        }),
      );
      await reporter.onRunComplete();

      expect(log.above()).toEqual([
        "warn: Could not report src/broken.test.js: Jest could not run it (Error: Cannot find module './missing')",
      ]);
    });

    it.each([
      [
        'with the file',
        {},
        "src/login.test.js > Test execution failure: could be caused by test hooks like 'afterAll'.",
      ],
      [
        'without the file',
        { keyIncludesFile: false },
        "Test execution failure: could be caused by test hooks like 'afterAll'.",
      ],
    ])(
      'sends the failure of a file whose tests ran, as the failed test jest-junit writes for it, %s',
      async (_mode, options: ProbaraJestOptions, key) => {
        const { reporter, log } = start(options);
        const test = fakeTest();
        const passed = fakeCaseResult(version, { titles: ['login', 'logs in'] });
        reporter.onTestFileStart(test);
        reporter.onTestCaseResult(test, passed);
        reporter.onTestFileResult(
          test,
          fakeFileResult(version, test, [passed], {
            // What jest-circus sets when an afterAll hook throws: no message, the error in the stack.
            testExecError: { message: '', stack: 'Error: teardown failed\n    at afterAll' },
          }),
        );
        await reporter.onRunComplete();

        expect(sent()).toEqual([
          [key.replace(/Test execution.*/, 'login logs in'), 'passed', null],
          [key, 'failed', expect.stringContaining('Error: teardown failed')],
        ]);
        expect(log.above().filter((line) => line.startsWith('warn'))).toEqual([]);
      },
    );

    it('sends a skipped test and a test of the same name that ran, each once', async () => {
      const { reporter } = start();
      const test = fakeTest();
      const ran = fakeCaseResult(version, { titles: ['login', 'logs in'] });
      const skipped = fakeCaseResult(version, {
        titles: ['login', 'logs in'],
        status: 'pending',
        duration: null,
      });
      reporter.onTestFileStart(test);
      reporter.onTestCaseResult(test, ran);
      reporter.onTestFileResult(test, fakeFileResult(version, test, [skipped, ran]));
      await reporter.onRunComplete();

      expect(sent()).toEqual([
        ['src/login.test.js > login logs in', 'passed', null],
        ['src/login.test.js > login logs in', 'skipped', null],
      ]);
    });

    it('sends each attempt once when two Jest projects run the same file at the same time', async () => {
      const { reporter } = start();
      const [node, dom] = [
        fakeTest('src/login.test.js', 'node'),
        fakeTest('src/login.test.js', 'dom'),
      ];
      const logsIn = fakeCaseResult(version, { titles: ['login', 'logs in'] });
      const skipped = fakeCaseResult(version, {
        titles: ['login', 'supports SSO'],
        status: 'pending',
        duration: null,
      });
      reporter.onTestFileStart(node);
      reporter.onTestFileStart(dom);
      // Jest hands the case events of every project the first project's context.
      reporter.onTestCaseResult(node, logsIn);
      reporter.onTestCaseResult(node, logsIn);
      reporter.onTestFileResult(dom, fakeFileResult(version, dom, [logsIn, skipped]));
      reporter.onTestFileResult(node, fakeFileResult(version, node, [logsIn, skipped]));
      await reporter.onRunComplete();

      expect(sent()).toEqual([
        ['src/login.test.js > login logs in', 'passed', null],
        ['src/login.test.js > login logs in', 'passed', null],
        ['src/login.test.js > login supports SSO', 'skipped', null],
        ['src/login.test.js > login supports SSO', 'skipped', null],
      ]);
    });

    it("fills a title's {displayName} with the name of the file's Jest project, like jest-junit", async () => {
      const { reporter } = start();
      const test = fakeTest('src/login.test.js', 'dom');
      const shows = fakeCaseResult(version, { titles: ['login', 'runs in {displayName}'] });
      reporter.onTestFileStart(test);
      reporter.onTestCaseResult(test, shows);
      reporter.onTestFileResult(test, {
        ...fakeFileResult(version, test, [shows]),
        displayName: { name: 'dom', color: 'blue' },
      });
      await reporter.onRunComplete();

      expect(sent()).toEqual([['src/login.test.js > login runs in dom', 'passed', null]]);
    });

    it("fills a {displayName} with each project's own name when two projects run the file at once", async () => {
      const { reporter, log } = start();
      const [node, dom] = [
        fakeTest('src/login.test.js', 'node'),
        fakeTest('src/login.test.js', 'dom'),
      ];
      const shows = fakeCaseResult(version, { titles: ['login', 'runs in {displayName}'] });
      const logsIn = fakeCaseResult(version, { titles: ['login', 'logs in'] });
      reporter.onTestFileStart(node);
      reporter.onTestFileStart(dom);
      // Jest hands the case events of every project the first project's context.
      for (const attempt of [shows, logsIn, shows, logsIn])
        reporter.onTestCaseResult(node, attempt);
      reporter.onTestFileResult(dom, {
        ...fakeFileResult(version, dom, [shows, logsIn]),
        displayName: { name: 'dom', color: 'blue' },
      });
      reporter.onTestFileResult(node, {
        ...fakeFileResult(version, node, [shows, logsIn]),
        displayName: { name: 'node', color: 'green' },
      });
      await reporter.onRunComplete();

      expect(sent().map(([key]) => key)).toEqual([
        'src/login.test.js > login logs in',
        'src/login.test.js > login logs in',
        'src/login.test.js > login runs in dom',
        'src/login.test.js > login runs in node',
      ]);
      expect(log.above().filter((line) => line.startsWith('warn:'))).toEqual([
        'warn: Several Jest projects ran this file at once: a test whose title holds {displayName} is sent once per project, its last attempt only (first seen in src/login.test.js; repeats are logged at debug)',
      ]);
    });

    it('keys without the file with keyIncludesFile false', async () => {
      const { reporter } = start({ keyIncludesFile: false });
      const test = fakeTest();
      reporter.onTestCaseResult(
        test,
        fakeCaseResult(version, { titles: ['login', 'PRB-12 logs in'] }),
      );
      await reporter.onRunComplete();

      expect(fake.reports()[0]?.results[0]).toMatchObject({
        automationKey: 'login logs in',
        caseDisplayId: 'PRB-12',
        suitePath: ['login'],
      });
    });

    it('logs the counts of what it handed over, then core logs the run link', async () => {
      const { reporter, log } = start();
      const test = fakeTest();
      reporter.onTestCaseResult(test, fakeCaseResult(version, { titles: ['a'], status: 'failed' }));
      reporter.onTestCaseResult(test, fakeCaseResult(version, { titles: ['a'], invocations: 2 }));
      reporter.onTestFileResult(
        test,
        fakeFileResult(version, test, [
          fakeCaseResult(version, { titles: ['a'], invocations: 2 }),
          fakeCaseResult(version, { titles: ['b'], status: 'pending' }),
        ]),
      );
      await reporter.onRunComplete();

      expect(log.above()).toEqual([
        'info: Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped, 0 blocked)',
        expect.stringMatching(
          /^info: Recorded 3 results \(2 new cases, 0 unmatched\) in R-1 \(closed\): /,
        ),
      ]);
    });

    it('names itself first in the User-Agent', async () => {
      const { reporter } = start();
      reporter.onTestCaseResult(fakeTest(), fakeCaseResult(version));
      await reporter.onRunComplete();

      expect(fake.requestsTo('report')[0]?.headers['user-agent']).toMatch(
        /^probara-jest-reporter\/0\.1\.0 probara-core\//,
      );
    });

    it('logs one redacted error line for an attempt it cannot translate, and sends the others', async () => {
      const { reporter, log } = start();
      const broken = fakeCaseResult(version);
      Object.defineProperty(broken, 'ancestorTitles', {
        get: () => {
          throw new Error(`broken titles for ${TOKEN}`);
        },
      });
      reporter.onTestCaseResult(fakeTest(), broken);
      reporter.onTestCaseResult(fakeTest(), fakeCaseResult(version));
      await reporter.onRunComplete();

      expect(fake.reports()[0]?.results).toHaveLength(1);
      expect(log.above()[0]).toBe(
        'error: Could not report an attempt of "logs in": broken titles for [redacted]',
      );
    });

    it('never fails the Jest run when reporting fails', async () => {
      fake.fail('report', { status: 422 });
      const { reporter, log } = start();
      reporter.onTestCaseResult(fakeTest(), fakeCaseResult(version));

      await expect(reporter.onRunComplete()).resolves.toBeUndefined();
      expect(reporter.getLastError()).toBeUndefined();
      expect(log.above().some((line) => line.startsWith('error: 1 result was not sent'))).toBe(
        true,
      );
    });
  },
);

describe('ProbaraJestReporter root directory', () => {
  it("keys files relative to the real path of the working directory, like jest-junit's", async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const reporter = new ProbaraJestReporter(GLOBAL_CONFIG, {
        env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'PRB', PROBARA_BASE_URL: fake.baseUrl },
        logger: capturingLogger().logger,
      });
      void reporter.onRunStart();
      reporter.onTestCaseResult(
        { path: join(realpathSync(process.cwd()), 'src', 'cart.test.js') },
        fakeCaseResult(30, { titles: ['cart', 'adds'] }),
      );
      await reporter.onRunComplete();

      expect(fake.reports()[0]?.results[0]?.automationKey).toBe('src/cart.test.js > cart adds');
    } finally {
      await fake.close();
    }
  });
});
