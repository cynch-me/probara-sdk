/**
 * The Mocha reporter, on a fake of what Cypress hands it: the runner of one spec, in the process
 * Cypress drives every spec of the run in.
 *
 * It does not talk to Probara: it builds the results of the spec and hands them over to the plugin
 * process (`session-files.ts`), which sends them with the run it owns. What it reads is what the
 * plugin left in the session: the browser of the run, the screenshots Cypress took, and what the
 * `probara.*` helpers of the browser said. A run whose Cypress config registers no plugin has
 * nobody to hand its results to, and then it sends them itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ProbaraCypressReporter from './index.js';
import { resetOwnReports } from './reporter.js';
import { session } from './session.js';
import {
  BROWSER_FILE,
  LINES_FILE,
  PLUGIN_FILE,
  readLines,
  readScreenshots,
  resultsFile,
  screenshotsFile,
  sessionDir,
  writeJson,
  type SessionLine,
  type SpecResults,
} from './session-files.js';
import {
  fails,
  flaky,
  fakeRunner,
  passes,
  runSpec,
  screenshotPath,
  type FakeScreenshot,
  skipped,
  suite,
  type FakeSpec,
} from '../test/support/cypress-fakes.js';
import { startSlowProbara } from '../test/support/slow-probara.js';
import { until } from '../test/support/wait.js';
import type { ProbaraCypressOptions } from './options.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const SPEC = 'cypress/e2e/cart.cy.js';
/** Where the package runs its own tests: nothing of a run may land there. */
const PACKAGE_DIR = join(__dirname, '..');

/** What the reporter logged, on every level. */
function capturingLogger() {
  const lines: string[] = [];
  const write = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`);
  };
  return {
    lines,
    logger: {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
    },
  };
}

/** One spec of a run, as the reporter saw it: the runner Cypress built, and what it reported. */
function report(
  spec: FakeSpec,
  file = SPEC,
  {
    screenshots = [] as (string | FakeScreenshot)[],
    linesBefore,
    selection,
  }: {
    /** What `after:screenshot` handed the plugin before the spec ran: a path, or its details. */
    screenshots?: (string | FakeScreenshot)[];
    /**
     * What the plugin's `probara` task writes before a Mocha event, as the browser sent it: what a
     * `probara.*` helper said between two events of the run.
     */
    linesBefore?: (event: string, runnable: { title: string }) => SessionLine[];
    /** What the plugin wrote of the run selection of the spec. */
    selection?: { run: string; deselected: string[][] };
  } = {},
): ProbaraCypressReporter {
  // What the plugin process of this run left in the session, before the reporter is built: the
  // directory it meets it in is the one this process opens for itself.
  const dir = sessionDir(process.pid);
  writeJson(dir, PLUGIN_FILE, { version: '0.1.0', readyAt: Date.now() });
  writeJson(dir, BROWSER_FILE, { name: 'electron' });
  writeJson(dir, LINES_FILE, []);
  writeJson(dir, 'selection.json', {});
  if (selection !== undefined) writeJson(dir, 'selection.json', { [file]: selection });
  if (screenshots.length > 0) {
    writeJson(
      dir,
      screenshotsFile(file),
      screenshots.map((shot) => (typeof shot === 'string' ? { path: shot } : shot)),
    );
  }
  const runner = fakeRunner(file);
  const reporter = new ProbaraCypressReporter(runner.runner, {
    reporterOptions: {
      projectId: 'SHOP',
      logger: log.logger,
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
      ...options,
    },
  });
  if (linesBefore !== undefined) {
    // The lines of the helpers land in the session before the event that follows them, exactly as
    // a `cy.task` of the browser is awaited before the test goes on.
    const emit = runner.emit.bind(runner);
    runner.emit = ((event: never, ...args: never[]) => {
      const runnable = args[0] as { title?: string } | undefined;
      // The event first, then what the browser sent while Cypress ran it: a `cy.task` is awaited
      // before the test goes on, so its lines are in the session before the next event.
      (emit as (...given: never[]) => void)(event, ...args);
      if (typeof runnable?.title === 'string') {
        const written = linesBefore(event, { title: runnable.title });
        if (written.length > 0) writeJson(dir, LINES_FILE, [...readLines(dir), ...written]);
      }
    }) as typeof runner.emit;
  }
  runSpec(runner, file, spec, (shot) => {
    // What the plugin's `after:screenshot` writes, as Cypress takes the file.
    writeJson(dir, screenshotsFile(file), [...readScreenshots(dir, file), shot]);
  });
  return reporter;
}

/** What the reporter handed over for a spec: its results, in the order it built them. */
function handedOver(file = SPEC): SpecResults | undefined {
  try {
    return JSON.parse(
      readFileSync(`${sessionDir(process.pid)}/${resultsFile(file)}`, 'utf8'),
    ) as SpecResults;
  } catch {
    return undefined;
  }
}

/** `<key> → <status>` of what the reporter built. */
function entriesOf(file = SPEC): Record<string, string[]> {
  const entries: Record<string, string[]> = {};
  for (const { input } of handedOver(file)?.results ?? []) {
    const key = input.identity.titlePath.join(' | ');
    (entries[key] ??= []).push(input.status);
  }
  return entries;
}

let fake: FakeProbara;
let log: ReturnType<typeof capturingLogger>;
let options: ProbaraCypressOptions;

beforeEach(async () => {
  session.reset();
  // The specs a run without a plugin reported on its own, and the send in flight, are this
  // process' own: each test starts with none, and reports to the Probara of its own options.
  resetOwnReports();
  log = capturingLogger();
  fake = await startFakeProbara({ token: TOKEN });
  options = { projectId: 'SHOP', logger: log.logger };
});

afterEach(async () => {
  await fake.close();
  resetOwnReports();
  session.reset();
});

describe('a spec of a Cypress run', () => {
  it('hands over a passing, a failing and a skipped test, each keyed with its spec', () => {
    report({
      describes: [
        suite('Cart', {
          tests: [passes('adds an item'), fails('fails on purpose'), skipped('is skipped')],
        }),
      ],
    });

    expect(entriesOf()).toEqual({
      'Cart adds an item': ['passed'],
      'Cart fails on purpose': ['failed'],
      'Cart is skipped': ['skipped'],
    });
    expect(handedOver()?.results[0]?.input.identity.file).toBe(SPEC);
  });

  it('hands over every attempt of a retried test, in order, the failed one with its error', () => {
    report({ tests: [flaky('is flaky')] });

    const results = (handedOver()?.results ?? []).map(({ input }) => input);
    expect(results.map((result) => result.status)).toEqual(['failed', 'passed']);
    // The attempt number is a parameter of a retry, so Probara shows which one it holds.
    expect(results.map((result) => result.parameters)).toEqual([
      { browser: 'electron' },
      { browser: 'electron', attempt: '2' },
    ]);
    expect(results[0]?.error).toBeDefined();
    expect(results[1]?.error).toBeUndefined();
  });

  it('sends the browser it runs as a parameter of every result, never in the key', () => {
    report({ tests: [passes('adds an item')] });

    const [first] = (handedOver()?.results ?? []).map(({ input }) => input);
    expect(first?.parameters).toEqual({ browser: 'electron' });
    expect(first?.identity.titlePath).toEqual(['adds an item']);
  });

  it('sends no browser parameter with browserAsParameter false', () => {
    options.browserAsParameter = false;
    report({ tests: [passes('adds an item')] });

    expect(handedOver()?.results[0]?.input.parameters).toBeUndefined();
  });

  it('gives every created case the spec and its describes as its suite, and links the ids of the titles', () => {
    report({
      describes: [
        suite('SHOP-7 Cart', { tests: [passes('SHOP-12 adds an item')] }),
        suite('Cart', { tests: [passes('WEB-3 keeps another id')] }),
      ],
    });

    const linked = handedOver()?.results[0]?.input;
    const other = handedOver()?.results[1]?.input;
    // A test that covers two cases is sent once per case, and the ids are those of the describe and
    // of the title.
    expect(linked?.caseDisplayIds).toEqual(['SHOP-7', 'SHOP-12']);
    expect(linked?.suitePath).toEqual([SPEC, 'Cart']);
    expect(other?.caseDisplayId).toBeUndefined();
    expect(other?.identity.titlePath).toEqual(['Cart WEB-3 keeps another id']);
  });

  it('drops the spec from the key with keyIncludesFile false', () => {
    options.keyIncludesFile = false;
    report({ tests: [passes('adds an item')] });

    expect(handedOver()?.results[0]?.input.identity).toEqual({ titlePath: ['adds an item'] });
  });

  it('sends when the attempt started and how long it took', () => {
    report({ tests: [passes('adds an item', { duration: 1234 })] });

    const first = handedOver()?.results[0]?.input;
    expect(first?.durationMs).toBe(1234);
    expect(typeof first?.startedAt).toBe('string');
  });

  it('attaches the screenshot of each failed attempt to that attempt, by the name Cypress gave it', () => {
    report({ tests: [{ title: 'fails twice', attempts: ['fail', 'fail'] }] }, SPEC, {
      screenshots: [
        screenshotPath(SPEC, ['fails twice'], 1),
        screenshotPath(SPEC, ['fails twice'], 2),
      ],
    });

    const attachments = (handedOver()?.results ?? []).flatMap(
      ({ input }) => input.attachments ?? [],
    );
    expect(attachments.map((file) => file.name).sort()).toEqual(
      ['fails twice (failed).png', 'fails twice (failed) (attempt 2).png'].sort(),
    );
    expect(attachments.every((file) => file.contentType === 'image/png')).toBe(true);
  });

  it('attaches a screenshot of a Windows path, named by its own file name', () => {
    const shot = 'C:\\work\\app\\cypress\\screenshots\\cart.cy.js\\fails on purpose (failed).png';
    report({ tests: [fails('fails on purpose')] }, SPEC, {
      screenshots: [{ path: shot, testFailure: true, testAttemptIndex: 0 }],
    });

    const attachments = (handedOver()?.results ?? []).flatMap(
      ({ input }) => input.attachments ?? [],
    );
    expect(attachments.map((file) => [file.path, file.name])).toContainEqual([
      shot,
      'fails on purpose (failed).png',
    ]);
  });

  it('attaches the screenshot of a title Cypress had to clean: without / : and quotes', () => {
    // Measured in Cypress 16.1.1: `it('fails: with / and : and "q"')` is saved as
    // `fails with  and  and q (failed).png`.
    report({ tests: [{ title: 'fails: with / and : and "q"', attempts: ['fail'] }] });

    const attachments = (handedOver()?.results ?? []).flatMap(
      ({ input }) => input.attachments ?? [],
    );
    expect(attachments.map((file) => file.name)).toEqual(['fails with  and  and q (failed).png']);
  });

  it('attaches each attempt its own screenshot of a title too long for a file name', () => {
    // Cypress cuts a name to 254 bytes, its ` (failed) (attempt N)` with it, and names a second
    // file of the same cut name ` (1)`: only the attempt index of `after:screenshot` tells them
    // apart (measured in Cypress 16.1.1).
    const title = `long ${'x'.repeat(300)}`;
    report({ tests: [{ title, attempts: ['retry', 'fail'] }] });

    const results = handedOver()?.results ?? [];
    const names = results.map(({ input }) => (input.attachments ?? []).map((file) => file.path));
    expect(names).toHaveLength(2);
    expect(names[0]).toHaveLength(1);
    expect(names[1]).toHaveLength(1);
    expect(names[0]?.[0]).not.toContain(' (1).png');
    expect(names[1]?.[0]).toMatch(/ \(1\)\.png$/);
    expect(log.lines.filter((line) => line.startsWith('debug: Left out'))).toEqual([]);
  });

  it('attaches no screenshot with attachScreenshots false, and says nothing about it', () => {
    options.attachScreenshots = false;
    report({ tests: [fails('fails on purpose')] }, SPEC, {
      screenshots: [screenshotPath(SPEC, ['fails on purpose'], 1)],
    });

    expect(handedOver()?.results[0]?.input.attachments).toBeUndefined();
    expect(log.lines.join('\n')).not.toContain('screenshot');
  });

  it('leaves a screenshot that names no test out, with one debug line', () => {
    // A `cy.screenshot('my own name')` of a test's own, beside the one of its failure.
    report({ tests: [fails('fails on purpose')] }, SPEC, {
      screenshots: [
        screenshotPath(SPEC, ['fails on purpose'], 1),
        `${sessionDir(process.pid)}/my own name.png`,
      ],
    });

    expect(handedOver()?.results[0]?.input.attachments ?? []).toHaveLength(1);
    expect(log.lines.filter((line) => line.startsWith('debug: Left out'))).toEqual([
      // The name it has without its extension, which is what Cypress names it by.
      expect.stringContaining('my own name'),
    ]);
  });

  it('hands the helpers of each attempt to that attempt, in the order the plugin wrote them', () => {
    // What the plugin's `probara` task writes while a test runs: the lines of the first test, and
    // then the one of the second.
    report({ tests: [passes('first'), passes('second')] }, SPEC, {
      linesBefore: (event, { title }) =>
        event === 'test'
          ? [
              {
                file: SPEC,
                test: title,
                type: 'message',
                message: { type: 'title', value: `Adds ${title}` },
              },
            ]
          : [],
    });
    expect(handedOver()?.results.map(({ input }) => input.title)).toEqual([
      'Adds first',
      'Adds second',
    ]);
  });

  it('gives each attempt of a retried test only what its own attempt said', () => {
    // Cypress announces a test once and reports each of its attempts with its own event: what the
    // helpers said between the first attempt's `test` and its `retry` is that attempt's alone.
    let attempt = 1;
    report({ tests: [flaky('passes on its retry')] }, SPEC, {
      linesBefore: (event, { title }) => {
        if (event === 'retry') attempt = 2;
        if (event !== 'test' && event !== 'retry' && event !== 'pass') return [];
        return [
          {
            file: SPEC,
            test: title,
            type: 'message',
            message: { type: 'comment', value: `attempt ${String(attempt)}` },
          },
        ];
      },
    });

    const results = handedOver()?.results ?? [];
    expect(results).toHaveLength(2);
    expect(results[0]?.input.comment).toBe('attempt 1');
    expect(results[1]?.input.comment).toBe('attempt 2');
  });

  it('leaves a line of another test out, with one warning, and never gives it to another test', () => {
    // A helper called in a hook of the suite, while another test runs: the browser stamped that
    // test, and the reporter does not move what it said to the test that runs.
    report({ tests: [passes('first'), passes('second')] }, SPEC, {
      linesBefore: (event, runnable) =>
        event === 'test' && runnable.title === 'second'
          ? [
              {
                file: SPEC,
                test: 'first',
                type: 'message',
                message: { type: 'title', value: 'Never attributed' },
              },
            ]
          : [],
    });

    expect(handedOver()?.results.map(({ input }) => input.title)).toEqual([undefined, undefined]);
    expect(log.lines.filter((line) => line.includes('belongs to no attempt that ran'))).toEqual([
      expect.stringContaining('probara.title()'),
    ]);
  });

  it('leaves a helper of a hook that runs no test out, with one warning naming the file', () => {
    // A suite-level `before` runs after the suite began and before its first test: the browser
    // stamped no test, and the reporter never invents one.
    report({ tests: [passes('adds an item')], describes: [suite('Cart')] }, SPEC, {
      linesBefore: (event) =>
        event === 'suite'
          ? [
              {
                file: SPEC,
                test: '',
                type: 'message',
                message: { type: 'title', value: 'Runs before any test' },
              },
            ]
          : [],
    });

    expect(handedOver()?.results[0]?.input.title).toBeUndefined();
    expect(log.lines.filter((line) => line.includes('belongs to no attempt that ran'))).toEqual([
      expect.stringContaining(SPEC),
    ]);
  });

  it('gives a helper of the `after` of a suite to the last test of it, as Cypress names it', () => {
    // Cypress still names the last test of a describe as the running one in the describe's `after`
    // hook (verified in a real run), and its root `afterEach` runs after that `after all`: nothing
    // in the transport tells the two apart, so what a helper says there is that test's own.
    report(
      { tests: [passes('adds an item')], describes: [suite('Cart', { afterAll: true })] },
      SPEC,
      {
        linesBefore: (event, { title }) =>
          event === 'hook' && title.includes('after all')
            ? [
                {
                  file: SPEC,
                  test: 'adds an item',
                  type: 'message',
                  message: { type: 'title', value: 'Said after the suite' },
                },
              ]
            : [],
      },
    );

    expect(handedOver()?.results[0]?.input.title).toBe('Said after the suite');
    expect(log.lines.filter((line) => line.includes('belongs to no attempt'))).toEqual([]);
  });

  it('hands a helper an afterEach said to the test that ran, and reads it before it reports', () => {
    // Cypress reports the outcome of a test before its `afterEach` runs: the details of the attempt
    // are read when the spec ends, so what its own hooks said after it ended is still its own.
    report({ tests: [passes('adds an item')] }, SPEC, {
      linesBefore: (event) =>
        event === 'test end'
          ? [
              {
                file: SPEC,
                test: 'adds an item',
                type: 'message',
                message: { type: 'comment', value: 'from the afterEach' },
              },
            ]
          : [],
    });

    expect(handedOver()?.results[0]?.input.comment).toBe('from the afterEach');
  });

  it('logs a warning of the browser once, naming the file and the test it came from', () => {
    report({ tests: [passes('adds an item')] }, SPEC, {
      linesBefore: (event) =>
        event === 'test'
          ? [
              {
                file: SPEC,
                test: 'adds an item',
                type: 'warning',
                message: 'probara.link() takes an absolute http(s) URL of at most 2048 characters',
              },
            ]
          : [],
    });

    expect(log.lines.filter((line) => line.includes('probara.link()'))).toEqual([
      `warn: probara.link() takes an absolute http(s) URL of at most 2048 characters (first seen in ${SPEC} › adds an item; repeats are logged at debug)`,
    ]);
  });

  it('leaves the tests the run selection skipped out of the report, and counts them', () => {
    report(
      {
        tests: [passes('in the run'), skipped('left out')],
        describes: [suite('Cart', { tests: [passes('also in the run')] })],
      },
      SPEC,
      { selection: { run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3', deselected: [['left out']] } },
    );

    expect(handedOver()?.results.map(({ input }) => input.identity.titlePath)).toEqual([
      ['in the run'],
      ['Cart also in the run'],
    ]);
    // What the plugin logs at `after:run`, in the Jest reporter's wording.
    expect(handedOver()?.selection).toEqual({
      run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3',
      tests: 3,
      skipped: 1,
    });
  });

  it('reports every test of a spec no selection touched', () => {
    report({ tests: [passes('in the run'), skipped('left out')] });

    expect(handedOver()?.results).toHaveLength(2);
    expect(handedOver()?.selection).toBeUndefined();
  });

  it('hands over what probara.ignore() dropped as the count the plugin logs', () => {
    report({ tests: [passes('adds an item')] });

    expect(handedOver()?.ignored).toBe(0);
  });

  it('leaves nothing in the directory it runs in: a run that never opened its own writes nowhere', () => {
    const before = readdirSync(PACKAGE_DIR).sort();
    // No `open()`: the session never found the directory of this run (a Cypress that reports from
    // another process, or a test that does not drive one).
    new ProbaraCypressReporter(undefined, {
      reporterOptions: {
        projectId: 'SHOP',
        logger: log.logger,
        env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
        enabled: false,
      },
    });
    report({ tests: [passes('adds an item')] });
    expect(readdirSync(PACKAGE_DIR).sort()).toEqual(before);
  });

  it('never throws into Cypress, whatever the runner gives it', () => {
    const runner = {
      suite: {
        get file(): string {
          throw new Error('no spec for you');
        },
      },
      on(): unknown {
        throw new Error('and no events either');
      },
    };
    expect(
      () =>
        new ProbaraCypressReporter(runner as never, {
          reporterOptions: { projectId: 'SHOP', logger: log.logger, env: {} },
        }),
    ).not.toThrow();
    expect(log.lines.join('\n')).not.toContain('and no events either');
  });

  it('warns about an option it does not know, and hands the results over all the same', () => {
    (options as Record<string, unknown>).notAnOption = true;
    report({ tests: [passes('adds an item')] });

    expect(log.lines.filter((line) => line.includes('unknown option'))).toEqual([
      'warn: Ignored the unknown option "notAnOption" of @probara/cypress-reporter',
    ]);
    expect(entriesOf()).toEqual({ 'adds an item': ['passed'] });
  });
});

describe('a hook that fails', () => {
  it('reports the failed attempt as its own, then the passing retry', () => {
    report({
      describes: [suite('Cart', { beforeEachFails: 'once', tests: [flaky('adds an item')] })],
    });

    expect(entriesOf()).toEqual({ 'Cart adds an item': ['failed', 'passed'] });
  });

  it('attaches the screenshot the always-failing hook took, named after the hook', () => {
    report(
      {
        describes: [suite('Checkout', { beforeEachFails: 'always', tests: [flaky('never runs')] })],
      },
      SPEC,
      {
        screenshots: [
          screenshotPath(SPEC, ['Checkout', 'never runs'], 1),
          screenshotPath(SPEC, ['Checkout', 'never runs'], 2, 'before each hook'),
        ],
      },
    );

    // Cypress names the file of a failed hook after the hook, after the test it was running.
    const hookShot = screenshotPath(SPEC, ['Checkout', 'never runs'], 2, 'before each hook');
    expect(hookShot).toContain('Checkout -- never runs -- before each hook (failed) (attempt 2)');
    const attachments = (handedOver()?.results ?? []).flatMap(
      ({ input }) => input.attachments ?? [],
    );
    expect(attachments.map((file) => file.name)).toContain(
      'Checkout -- never runs -- before each hook (failed) (attempt 2).png',
    );
  });

  it('reports one failed synthetic hook test and skips the rest of the suite when it fails every attempt', () => {
    report({
      describes: [
        suite('Cart', {
          beforeEachFails: 'always',
          tests: [flaky('adds an item'), passes('removes an item')],
        }),
        suite('Checkout', { tests: [passes('pays by card')] }),
      ],
    });

    expect(entriesOf()).toEqual({
      'Cart adds an item': ['failed'],
      'Cart "before each" hook for "adds an item"': ['failed'],
      'Cart removes an item': ['skipped'],
      'Checkout pays by card': ['passed'],
    });
  });
});

describe('a run whose Cypress config registers no plugin', () => {
  it('sends the results of each spec itself, in a run of its own, with one warning', async () => {
    const runner = fakeRunner(SPEC);
    new ProbaraCypressReporter(runner.runner, {
      reporterOptions: {
        projectId: 'SHOP',
        logger: log.logger,
        env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
      },
    });
    runSpec(runner, SPEC, { tests: [passes('adds an item')] }, () => undefined);
    // Nothing waits for it on the product's side either: Cypress kills this process, so the send
    // is already on its way. This is the wait for it here.
    await until(() => fake.reports().length === 1, 'the report a run without a plugin sent itself');

    expect(
      fake
        .reports()
        .flatMap((report: ReportRequest) => report.results)
        .map((r) => r.automationKey),
    ).toEqual([`${SPEC} > adds an item`]);
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
    expect(log.lines.filter((line) => line.includes('setupNodeEvents'))).toEqual([
      expect.stringContaining('first seen in'),
    ]);
  });

  it('sends the results itself even when Probara answers slowly', async () => {
    // Nothing waits for this send on the product's side either: Cypress kills the reporter process
    // ~50 ms after the last spec, so whatever the API takes, the results go out and the process
    // waits for them. A Probara with a round trip of its own (a busy CI runner, a real API) must not
    // lose them, which is what a test that sleeps a fixed 50 ms and calls that a pass would allow.
    const slow = await startSlowProbara(fake.baseUrl, { delayMs: 200 });
    try {
      const runner = fakeRunner(SPEC);
      new ProbaraCypressReporter(runner.runner, {
        reporterOptions: {
          projectId: 'SHOP',
          logger: log.logger,
          env: {
            PROBARA_API_TOKEN: TOKEN,
            PROBARA_PROJECT: 'SHOP',
            PROBARA_BASE_URL: slow.baseUrl,
          },
        },
      });
      runSpec(runner, SPEC, { tests: [passes('adds an item')] }, () => undefined);

      await until(
        () => fake.reports().length === 1,
        'the report of a run without a plugin, from a slow Probara',
      );
      expect(
        fake
          .reports()
          .flatMap((report: ReportRequest) => report.results)
          .map((result) => result.automationKey),
      ).toEqual([`${SPEC} > adds an item`]);
    } finally {
      await slow.close();
    }
  });
});
