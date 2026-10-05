/**
 * The `setupNodeEvents` plugin: what it registers, what it exposes to the browser, what the
 * `probara` task accepts, and the warnings of a run it is missing from.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import type { Logger } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakePlugin,
  fakeRunner,
  passes,
  runSpec,
  type FakePlugin,
} from '../test/support/cypress-fakes.js';
import ProbaraCypressReporter from './index.js';
import { probaraNodeEvents, REPORTER_MISSING } from './setup.js';
import { session } from './session.js';
import { VERSION } from './version.js';

const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
const SPEC = 'cypress/e2e/cart.cy.js';

/** Every line the plugin and the reporter logged, on every level. */
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
    } satisfies Logger,
  };
}

let fake: FakeProbara;
let log: ReturnType<typeof capturingLogger>;

beforeEach(async () => {
  session.reset();
  log = capturingLogger();
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
  session.reset();
});

/** A plugin configured against the fake Probara, with the reporter options set. */
function plugin(options: Record<string, unknown> = {}, config = {}): FakePlugin {
  const events = fakePlugin(config);
  events.config.reporterOptions = {
    projectId: 'SHOP',
    logger: log.logger,
    env: { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: fake.baseUrl },
    ...options,
  };
  return events;
}

describe('probaraNodeEvents', () => {
  it('registers every event of a run, once, and returns the config it was given', () => {
    const events = plugin();
    const config = events.config;
    expect(probaraNodeEvents(events.on, config)).toBe(config);
    expect(probaraNodeEvents(events.on, config)).toBe(config);
    for (const name of [
      'before:run',
      'before:spec',
      'after:screenshot',
      'after:spec',
      'after:run',
    ]) {
      // Cypress loads the config twice in a run that fails to start: the events then fire twice.
      expect(events.count(name)).toBe(2);
    }
    expect(events.task('probara')).toBeTypeOf('function');
  });

  it('never throws, whatever it is given', () => {
    const events = plugin();
    expect(() =>
      probaraNodeEvents(events.on, undefined as unknown as typeof events.config),
    ).not.toThrow();
    expect(() => probaraNodeEvents(undefined as never, events.config)).not.toThrow();
    expect(log.lines.join('\n')).not.toContain(TOKEN);
  });

  it('exposes what the browser side of the run needs, and nothing when nothing is reported', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    expect(events.config.expose).toEqual({
      probara: { version: VERSION, captureOutput: false },
    });

    session.reset();
    const off = plugin({ enabled: false });
    probaraNodeEvents(off.on, off.config);
    await off.emit('before:spec', { relative: SPEC });
    expect(off.config.expose).toEqual({});
  });

  it('exposes the cases of the run `runCasesOnly` takes its tests from', async () => {
    const runUlid = fake.seedRun({
      cases: [
        { caseDisplayId: 'SHOP-12', automationKey: 'cypress/e2e/cart.cy.js > Cart adds an item' },
        { caseDisplayId: 'SHOP-13', automationKey: null },
      ],
    });
    const events = plugin({ runCasesOnly: true, run: { ulid: runUlid } });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });

    expect(events.config.expose).toEqual({
      probara: {
        version: VERSION,
        captureOutput: false,
        selection: {
          run: runUlid,
          keys: ['cypress/e2e/cart.cy.js > Cart adds an item'],
          caseIds: ['SHOP-12', 'SHOP-13'],
          projectCodes: ['SHOP'],
          keyIncludesFile: true,
          rootDir: '/work/app',
        },
      },
    });
    // Read once, whatever the number of specs.
    await events.emit('before:spec', { relative: 'cypress/e2e/other.cy.js' });
    expect(fake.requestsTo('caseKeys')).toHaveLength(1);
  });

  it('warns once, without the token, when the cases of the run cannot be read', async () => {
    const events = plugin({ runCasesOnly: true });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    await events.emit('before:spec', { relative: SPEC });

    const warnings = log.lines.filter((line) => line.includes('runCasesOnly'));
    expect(warnings).toEqual([
      'warn: runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported',
    ]);
    expect(log.lines.join('\n')).not.toContain(TOKEN);
    expect(events.config.expose).toEqual({
      probara: { version: VERSION, captureOutput: false },
    });
  });

  it('accepts what the `probara.*` helpers of the browser send, and never fails a test with it', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });
    await events.emit('before:spec', { relative: SPEC });
    const runner = fakeRunner(SPEC);
    new ProbaraCypressReporter(runner.runner, { reporterOptions: events.config.reporterOptions });
    const task = events.task('probara');
    runner.emit('start');
    runner.emit('suite', { title: '', root: true, file: SPEC, suites: [], tests: [] });
    runner.emit('suite', { title: 'Cart', root: false, file: null, suites: [], tests: [] });
    runner.emit('test', { type: 'test', title: 'adds an item' });

    expect(task?.({ type: 'title', value: 'Adds an item' })).toBeNull();
    expect(task?.({ type: 'parameters', value: { build: '42' } })).toBeNull();
    expect(task?.({ type: 'not a message' })).toBeNull();
    // A payload that is no message at all is dropped, with one warning, and never thrown.
    expect(task?.('a string')).toBeNull();
    expect(task?.(42)).toBeNull();

    runner.emit('pass', { type: 'test', title: 'adds an item', currentRetry: () => 0 });
    runner.emit('end');
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 1, failures: 0 }, video: null },
    );
    await events.emit('after:run', { totalDuration: 1 });

    const [result] = fake.reports().flatMap((report) => report.results);
    expect(result?.title).toBe('Adds an item');
    expect(result?.parameters).toEqual({ browser: 'electron', build: '42' });
    // A payload that is no message is dropped with one warning; one that is a message of an
    // unknown kind goes with the attempt it was called in, and core's reader names it.
    expect(log.lines.filter((line) => line.includes('carries no helper message'))).toEqual([
      'warn: Ignored a probara task that carries no helper message (first seen in a probara task; repeats are logged at debug)',
      // The second call repeats it at debug, as every warning of the session does.
      'debug: Ignored a probara task that carries no helper message (a probara task)',
    ]);
    expect(log.lines.filter((line) => line.includes('malformed probara metadata'))).toEqual([
      'warn: Ignored malformed probara metadata (type "not a message") (first seen in "adds an item"; repeats are logged at debug)',
    ]);
  });

  it('warns once at the end of a run that registers no reporter of this package', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    await events.emit('after:run', { totalDuration: 1 });

    expect(log.lines.filter((line) => line.includes('no reporter'))).toEqual([
      `warn: ${REPORTER_MISSING} (first seen in the run; repeats are logged at debug)`,
    ]);
  });

  it('says nothing about a missing reporter when one reported', async () => {
    const events = plugin();
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:spec', { relative: SPEC });
    const runner = fakeRunner(SPEC);
    new ProbaraCypressReporter(runner.runner, { reporterOptions: events.config.reporterOptions });
    runSpec(runner, SPEC, { tests: [passes('adds an item')] }, () => undefined);
    await events.emit(
      'after:spec',
      { relative: SPEC },
      { stats: { tests: 1, failures: 0 }, video: null },
    );
    await events.emit('after:run', { totalDuration: 1 });

    expect(log.lines.filter((line) => line.includes('no reporter'))).toEqual([]);
  });

  it('never closes the run of an interactive session, and names it once', async () => {
    const events = plugin({}, { isInteractive: true });
    probaraNodeEvents(events.on, events.config);
    await events.emit('before:run', { browser: { name: 'electron' } });
    for (const file of [SPEC, 'cypress/e2e/other.cy.js']) {
      await events.emit('before:spec', { relative: file });
      const runner = fakeRunner(file);
      new ProbaraCypressReporter(runner.runner, { reporterOptions: events.config.reporterOptions });
      runSpec(runner, file, { tests: [passes('adds an item')] }, () => undefined);
      await events.emit(
        'after:spec',
        { relative: file },
        { stats: { tests: 1, failures: 0 }, video: null },
      );
    }
    await events.emit('after:run', { totalDuration: 1 });

    // One run for the whole session, still open.
    expect(fake.runs().map((created) => created.state)).toEqual(['open']);
    expect(log.lines.filter((line) => line.startsWith('info: Interactive mode'))).toEqual([
      expect.stringMatching(
        /^info: Interactive mode: every spec of this session reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid [0-9A-Z]{26}$/,
      ),
    ]);
  });
});
