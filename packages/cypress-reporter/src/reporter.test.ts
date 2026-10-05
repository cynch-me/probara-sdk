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
import type { ChannelLine, ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ProbaraCypressReporter from './index.js';
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
  type SpecResults,
} from './session-files.js';
import {
  fails,
  flaky,
  fakeRunner,
  passes,
  runSpec,
  screenshotPath,
  skipped,
  suite,
  type FakeSpec,
} from '../test/support/cypress-fakes.js';
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
    screenshots = [] as string[],
    lineOfTest,
  }: { screenshots?: string[]; lineOfTest?: (title: string) => ChannelLine } = {},
): ProbaraCypressReporter {
  // What the plugin process of this run left in the session, before the reporter is built: the
  // directory it meets it in is the one this process opens for itself.
  const dir = sessionDir(process.pid);
  writeJson(dir, PLUGIN_FILE, { version: '0.1.0', readyAt: Date.now() });
  writeJson(dir, BROWSER_FILE, { name: 'electron' });
  writeJson(dir, LINES_FILE, []);
  if (screenshots.length > 0) {
    writeJson(
      dir,
      screenshotsFile(file),
      screenshots.map((path) => ({ path })),
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
  if (lineOfTest !== undefined) {
    // What the plugin's `probara` task writes while a test runs, and the reporter reads when the
    // test ends: the line is in place before Mocha tells it the test began.
    const emit = runner.emit.bind(runner);
    runner.emit = ((event: never, ...args: never[]) => {
      const test = args[0] as { title?: string } | undefined;
      if (event === ('test' as never) && typeof test?.title === 'string') {
        const lines = readLines(dir);
        writeJson(dir, LINES_FILE, [...lines, lineOfTest(test.title)]);
      }
      (emit as (...given: never[]) => void)(event, ...args);
    }) as typeof runner.emit;
  }
  runSpec(runner, file, spec, (path) => {
    // What the plugin's `after:screenshot` writes, as Cypress takes the file.
    writeJson(dir, screenshotsFile(file), [...readScreenshots(dir, file), { path }]);
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
  log = capturingLogger();
  fake = await startFakeProbara({ token: TOKEN });
  options = { projectId: 'SHOP', logger: log.logger };
});

afterEach(async () => {
  await fake.close();
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
      lineOfTest: (title) =>
        ({
          type: 'message',
          message: { type: 'title', value: `Adds ${title}` },
        }) as ChannelLine,
    });
    expect(handedOver()?.results.map(({ input }) => input.title)).toEqual([
      'Adds first',
      'Adds second',
    ]);
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
    // Nothing waits for it: Cypress kills this process, so the send is already on its way.
    await new Promise((resolve) => setTimeout(resolve, 50));

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
});
