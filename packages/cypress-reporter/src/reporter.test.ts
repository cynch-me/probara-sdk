/**
 * The reporter, on a fake of what Cypress gives it: the Mocha runner of a spec and the plugin's
 * `on`, with the events in the order a real `cypress run` emits them, against a fake Probara. What
 * is asserted is what Probara receives: every attempt with its own key, status, error, parameters
 * and files, and what the reporter logs.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import type { ReportRequest } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probaraNodeEvents } from './setup.js';
import { VERSION } from './version.js';
import { session } from './session.js';
import ProbaraCypressReporter from './index.js';
import {
  assetsFolder,
  fails,
  flaky,
  fakePlugin,
  fakeRunner,
  passes,
  runSpec,
  skipped,
  suite,
  videoPath,
  type FakeSpec,
} from '../test/support/cypress-fakes.js';
import type { ProbaraCypressOptions } from './options.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const SPEC = 'cypress/e2e/cart.cy.js';

/** One run of the fake Probara, its workspace gone when the test ends. */
interface Harness {
  fake: FakeProbara;
  /** `config.expose.probara`, what the browser side of the run would read. */
  exposed(): unknown;
  /** Every `[probara]` line the reporter and the plugin logged, on every level. */
  log(): string[];
}

/** What the reporter and the plugin log, without core's own summary of the run. */
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

/**
 * One Cypress run of `fake`, with the plugin (unless `plugin` is false) and the reporter of every
 * spec, against a fake Probara.
 */
async function runCypress(
  fake: FakeProbara,
  specs: readonly { file: string; spec: FakeSpec; noReporter?: boolean }[],
  options: ProbaraCypressOptions = {},
  { plugin = true, browser = 'electron', video = true } = {},
): Promise<Harness> {
  const lines = capturingLogger();
  const events = fakePlugin();
  events.config.reporterOptions = {
    projectId: 'SHOP',
    logger: lines.logger,
    env: {
      PROBARA_API_TOKEN: TOKEN,
      PROBARA_PROJECT: 'SHOP',
      PROBARA_BASE_URL: fake.baseUrl,
    },
    ...options,
  };
  if (plugin) probaraNodeEvents(events.on, events.config);
  await events.emit('before:run', { browser: { name: browser } });
  for (const { file, spec, noReporter } of specs) {
    await events.emit('before:spec', { relative: file });
    const eventsOfSpec = fakeRunner(file);
    // Cypress never constructs a reporter for a spec it could not run (a syntax error): only the
    // plugin sees it, at `after:spec`.
    if (noReporter !== true) {
      new ProbaraCypressReporter(eventsOfSpec.runner, {
        reporterOptions: events.config.reporterOptions,
      });
    }
    runSpec(eventsOfSpec, file, spec, (path) => {
      writeAsset(path);
      void events.emit('after:screenshot', { path });
    });
    if (video) writeAsset(videoPath(file), 'a video');
    await events.emit(
      'after:spec',
      { relative: file },
      {
        stats: { tests: 3, failures: 1 },
        video: video ? videoPath(file) : null,
      },
    );
  }
  await events.emit('after:run', { totalDuration: 1000 });
  return {
    fake,
    exposed: () => events.config.expose?.probara,
    log: () => lines.lines,
  };
}

/** Every entry Probara received: its key, its case, and its status. */
function entriesOf(fake: FakeProbara): Record<string, string[]> {
  const entries: Record<string, string[]> = {};
  for (const result of fake.reports().flatMap((report: ReportRequest) => report.results)) {
    const label = `${result.automationKey ?? '?'} | ${result.caseDisplayId ?? '-'}`;
    (entries[label] ??= []).push(result.status);
  }
  return entries;
}

/** Every result Probara received, in the order they were sent. */
function resultsOf(fake: FakeProbara): ReportRequest['results'] {
  return fake.reports().flatMap((report) => report.results);
}

/** The one result whose key ends with `key`. */
function resultOf(fake: FakeProbara, key: string) {
  return resultsOf(fake).find((result) => result.automationKey?.endsWith(key) === true);
}

/** The one result whose key holds `key` anywhere (a hook's synthetic title is not the last one). */
function resultHolding(fake: FakeProbara, key: string) {
  return resultsOf(fake).find((result) => result.automationKey?.includes(key) === true);
}

let fake: FakeProbara;
/** Where the fake Cypress writes the screenshots and the video core uploads. */
let assets = '';

beforeEach(async () => {
  session.reset();
  fake = await startFakeProbara({ token: TOKEN });
  assets = realpathSync(mkdtempSync(join(tmpdir(), 'probara-cypress-assets-')));
  assetsFolder(assets);
});

afterEach(async () => {
  await fake.close();
  session.reset();
  if (assets !== '') rmSync(assets, { recursive: true, force: true });
});

/**
 * Writes the file Cypress would have written, so core has something to upload. Synchronous, like
 * the file Cypress takes: it exists before `after:screenshot` carries its path.
 */
function writeAsset(path: string, content = 'an asset'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('a spec of a Cypress run', () => {
  it('reports a passing, a failing and a skipped test in one closed run, keyed with the spec', async () => {
    const run = await runCypress(fake, [
      {
        file: SPEC,
        spec: {
          describes: [
            suite('Cart', {
              tests: [
                passes('adds an item'),
                fails('fails on purpose', { error: 'boom' }),
                skipped('is skipped'),
              ],
            }),
          ],
        },
      },
    ]);

    expect(entriesOf(fake)).toEqual({
      [`${SPEC} > Cart adds an item | -`]: ['passed'],
      [`${SPEC} > Cart fails on purpose | -`]: ['failed'],
      [`${SPEC} > Cart is skipped | -`]: ['skipped'],
    });
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
    expect(run.log().filter((line) => line.startsWith('info: Sending '))).toEqual([
      'info: Sending 3 results of 3 tests (1 passed, 1 failed, 1 skipped, 0 blocked)',
    ]);
    expect(run.log().join('\n')).not.toContain(TOKEN);
  });

  it('reports every attempt of a retried test, in order, the failed one with its error', async () => {
    await runCypress(fake, [{ file: SPEC, spec: { tests: [flaky('is flaky')] } }]);

    const results = resultsOf(fake);
    expect(results.map((result) => result.status)).toEqual(['failed', 'passed']);
    expect(results.map((result) => result.parameters)).toEqual([
      { browser: 'electron' },
      { browser: 'electron', attempt: '2' },
    ]);
    expect(results[0]?.notes).toContain('boom');
    expect(results[1]?.notes).toBeUndefined();
  });

  it('sends the browser it runs as a parameter of every result, never in the key', async () => {
    await runCypress(fake, [{ file: SPEC, spec: { tests: [passes('adds an item')] } }]);

    expect(resultOf(fake, 'adds an item')?.parameters).toEqual({ browser: 'electron' });
    expect(resultOf(fake, 'adds an item')?.automationKey).toBe(`${SPEC} > adds an item`);
  });

  it('sends no browser parameter with browserAsParameter false', async () => {
    await runCypress(fake, [{ file: SPEC, spec: { tests: [passes('adds an item')] } }], {
      browserAsParameter: false,
    });

    expect(resultOf(fake, 'adds an item')?.parameters).toBeUndefined();
  });

  it('gives every created case the spec and its describes as its suite, and links the case ids of the titles', async () => {
    await runCypress(fake, [
      {
        file: SPEC,
        spec: {
          describes: [
            suite('SHOP-7 Cart', { tests: [passes('SHOP-12 adds an item')] }),
            suite('Cart', { tests: [passes('WEB-3 keeps another id')] }),
          ],
        },
      },
    ]);

    const [linked, alsoLinked, other] = resultsOf(fake);
    // The ids of the describe and of the title: one entry per case, the first named by the report.
    expect([linked?.caseDisplayId, alsoLinked?.caseDisplayId]).toEqual(['SHOP-7', 'SHOP-12']);
    expect(linked?.suitePath).toEqual([SPEC, 'Cart']);
    // The id of a project it does not report to stays in the title, and links nothing.
    expect(other?.automationKey).toBe(`${SPEC} > Cart WEB-3 keeps another id`);
    expect(other?.caseDisplayId).toBeUndefined();
  });

  it('drops the spec from the key with keyIncludesFile false', async () => {
    await runCypress(fake, [{ file: SPEC, spec: { tests: [passes('adds an item')] } }], {
      keyIncludesFile: false,
    });

    expect(resultOf(fake, 'adds an item')?.automationKey).toBe('adds an item');
  });

  it('maps and filters what the options say, and counts only what core sends', async () => {
    await runCypress(
      fake,
      [{ file: SPEC, spec: { tests: [passes('adds an item'), fails('fails on purpose')] } }],
      { statusMapping: { failed: 'blocked' }, statusFilter: ['blocked'] },
    );

    expect(resultsOf(fake).map((result) => result.status)).toEqual(['passed']);
  });

  it('names the run it creates, and closes it at the end of the run', async () => {
    await runCypress(fake, [{ file: SPEC, spec: { tests: [passes('adds an item')] } }], {
      run: { name: 'Cypress #7' },
    });

    const [run] = fake.runs();
    expect(run?.name).toBe('Cypress #7');
    expect(run?.state).toBe('closed');
  });
});

describe('a hook that fails', () => {
  it('reports the failed attempt as its own, then the passing retry', async () => {
    await runCypress(fake, [
      {
        file: SPEC,
        spec: {
          describes: [suite('Cart', { beforeEachFails: 'once', tests: [flaky('adds an item')] })],
        },
      },
    ]);

    expect(entriesOf(fake)).toEqual({ [`${SPEC} > Cart adds an item | -`]: ['failed', 'passed'] });
    expect(resultsOf(fake)[0]?.notes).toContain('boom');
  });

  it('reports one failed synthetic hook test and skips the rest of the suite when it fails every attempt', async () => {
    await runCypress(fake, [
      {
        file: SPEC,
        spec: {
          describes: [
            suite('Cart', {
              beforeEachFails: 'always',
              tests: [flaky('adds an item'), passes('removes an item')],
            }),
            suite('Checkout', { tests: [passes('pays by card')] }),
          ],
        },
      },
    ]);

    expect(entriesOf(fake)).toEqual({
      [`${SPEC} > Cart adds an item | -`]: ['failed'],
      [`${SPEC} > Cart "before each" hook for "adds an item" | -`]: ['failed'],
      [`${SPEC} > Cart removes an item | -`]: ['skipped'],
      [`${SPEC} > Checkout pays by card | -`]: ['passed'],
    });
    // The error of the synthetic result is the hook's, not a skipped test's.
    const hook = resultHolding(fake, '"before each" hook for');
    expect(hook?.status).toBe('failed');
    // The error of the hook names the hook, as Cypress wrote it.
    expect(hook?.notes).toContain('boom');
    expect(hook?.notes).toContain('beforeEach');
  });

  it('never invents a skipped result for the test the hook was running', async () => {
    await runCypress(fake, [
      {
        file: SPEC,
        spec: {
          describes: [suite('Cart', { beforeEachFails: 'always', tests: [flaky('adds an item')] })],
        },
      },
    ]);

    // The failed attempt a `retry` event stands for is the one report of the real test; the walk
    // of the suite must not add a skipped one next to it.
    expect(entriesOf(fake)[`${SPEC} > Cart adds an item | -`]).toEqual(['failed']);
  });
});

describe('the screenshots and the video of a spec', () => {
  it('attaches the screenshot of each failed attempt to that attempt, by the name Cypress gave it', async () => {
    // A test that fails on both attempts: Cypress takes one screenshot per attempt, and names the
    // second one after the attempt it belongs to.
    const run = await runCypress(fake, [
      { file: SPEC, spec: { tests: [{ title: 'fails twice', attempts: ['fail', 'fail'] }] } },
    ]);

    // Core uploads the files of two results concurrently, so only their names are compared.
    const staged = fake.stagedFiles();
    expect(staged.map((file) => file.name).sort()).toEqual(
      ['fails twice (failed).png', 'fails twice (failed) (attempt 2).png'].sort(),
    );
    expect(staged.every((file) => file.type === 'image/png')).toBe(true);
    // Each attempt's screenshot went with its own result: two results, two uploads.
    expect(resultsOf(fake).map((result) => result.status)).toEqual(['failed', 'failed']);
    // The video is off by default: nothing else is uploaded.
    expect(fake.stagedFiles()).toHaveLength(2);
    expect(run.exposed()).toEqual({ version: VERSION, captureOutput: false });
  });

  it('attaches no screenshot with attachScreenshots false, and says nothing about it', async () => {
    const run = await runCypress(
      fake,
      [{ file: SPEC, spec: { tests: [fails('fails on purpose')] } }],
      {
        attachScreenshots: false,
      },
    );

    expect(fake.stagedFiles()).toEqual([]);
    expect(run.log().join('\n')).not.toContain('screenshot');
  });

  it('leaves a screenshot that names no test out, with one debug line', async () => {
    const run = await runCypress(
      fake,
      [
        {
          file: SPEC,
          spec: { tests: [fails('fails on purpose')] },
        },
      ],
      {},
      {},
    );

    // A `cy.screenshot('my own name')` names no test: it is left out, and the log says so at debug.
    await Promise.resolve();
    expect(fake.stagedFiles().map((file) => file.name)).toEqual(['fails on purpose (failed).png']);
    expect(run.log().filter((line) => line.startsWith('debug: Left out'))).toEqual([]);
  });

  it('attaches the video of the spec to every failed result of it, and to no passing one', async () => {
    await runCypress(
      fake,
      [{ file: SPEC, spec: { tests: [fails('fails on purpose'), passes('adds an item')] } }],
      { attachVideos: true },
    );

    // One upload per failed result of the spec, named as Cypress named its own file.
    const videos = fake.stagedFiles().filter((file) => file.type === 'video/mp4');
    expect(videos.map((file) => file.name)).toEqual(['cart.cy.js.mp4']);
    expect(resultsOf(fake).filter((result) => result.status === 'failed')).toHaveLength(1);
  });

  it('sends nothing of a spec whose video never arrives, without waiting for it forever', async () => {
    const events = fakePlugin();
    events.config.reporterOptions = {
      projectId: 'SHOP',
      logger: capturingLogger().logger,
      env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
      attachVideos: true,
    };
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });
    await events.emit('before:spec', { relative: SPEC });
    const eventsOfSpec = fakeRunner(SPEC);
    new ProbaraCypressReporter(eventsOfSpec.runner, {
      reporterOptions: events.config.reporterOptions,
    });
    runSpec(eventsOfSpec, SPEC, { tests: [fails('fails on purpose')] }, () => undefined);
    // No `after:spec`: the safety net sends the results anyway rather than lose them.
    expect(fake.reports()).toEqual([]);
    await events.emit('after:run', { totalDuration: 1 });
    expect(resultsOf(fake)).toHaveLength(1);
  });
});

describe('a spec Cypress could not run', () => {
  it('gets one failed result in the run of the other specs, so a broken spec is never green', async () => {
    const BROKEN = 'cypress/e2e/broken.cy.js';
    const run = await runCypress(fake, [
      { file: SPEC, spec: { tests: [passes('adds an item')] } },
      { file: BROKEN, spec: { tests: [] }, noReporter: true },
    ]);

    // Cypress reports no test of it: one failed result of its own, in the same run.
    const broken = resultOf(fake, 'Spec failed to run');
    expect(broken?.status).toBe('failed');
    expect(broken?.automationKey).toBe(`${BROKEN} > Spec failed to run`);
    expect(resultsOf(fake).map((result) => result.status)).toEqual(['passed', 'failed']);
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
    expect(run.exposed()).toEqual({ version: VERSION, captureOutput: false });
  });
});

describe('the reporter without its plugin', () => {
  it('still sends every result, warns once, and completes the run on the way out', async () => {
    const lines = capturingLogger();
    const events = fakeRunner(SPEC);
    new ProbaraCypressReporter(events.runner, {
      reporterOptions: {
        projectId: 'SHOP',
        logger: lines.logger,
        env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
      },
    });
    runSpec(events, SPEC, { tests: [passes('adds an item')] }, () => undefined);
    await session.complete();

    expect(entriesOf(fake)).toEqual({ [`${SPEC} > adds an item | -`]: ['passed'] });
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
    expect(lines.lines.filter((line) => line.includes('setupNodeEvents'))).toHaveLength(1);
    expect(lines.lines.join('\n')).not.toContain(TOKEN);
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
    const lines = capturingLogger();
    expect(
      () =>
        new ProbaraCypressReporter(runner as never, {
          reporterOptions: { projectId: 'SHOP', logger: lines.logger, env: {} },
        }),
    ).not.toThrow();
    expect(lines.lines.join('\n')).not.toContain('and no events either');
  });

  it('accepts the options cypress-multi-reporters wraps in a single @probara key', async () => {
    const events = fakePlugin();
    events.config.reporterOptions = {
      '@probara/cypress-reporter': {
        projectId: 'SHOP',
        logger: capturingLogger().logger,
        env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
      },
    };
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    const eventsOfSpec = fakeRunner(SPEC);
    new ProbaraCypressReporter(eventsOfSpec.runner, {
      reporterOptions: events.config.reporterOptions,
    });
    runSpec(eventsOfSpec, SPEC, { tests: [passes('adds an item')] }, () => undefined);
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 1, failures: 0 }, video: null },
    );
    await events.emit('after:run', { totalDuration: 1 });

    expect(entriesOf(fake)).toEqual({ [`${SPEC} > adds an item | -`]: ['passed'] });
  });

  it('warns about an option it does not know, and reports all the same', async () => {
    const run = await runCypress(
      fake,
      [{ file: SPEC, spec: { tests: [passes('adds an item')] } }],
      {
        captureOutputs: true,
      } as ProbaraCypressOptions,
    );

    expect(run.log().filter((line) => line.includes('unknown option'))).toEqual([
      'warn: Ignored the unknown option "captureOutputs" of @probara/cypress-reporter',
    ]);
    expect(resultsOf(fake)).toHaveLength(1);
  });
});
