/**
 * A fake of what Cypress gives the two entry points of a run, shaped like the real one: the Mocha
 * runner it creates for a spec (one reporter per spec, `runner.suite.file` naming it), and the
 * `on` of `setupNodeEvents`. The events come in the order a real `cypress run` emits them, which is
 * what the reporter and the session are written against: `before:run`, `before:spec`, the Mocha
 * events of the spec (an `after:screenshot` before the outcome it belongs to), then `after:spec`
 * and `after:run`.
 *
 * Every rule below was observed in a real Cypress 16.1.1 run (see `odd/cypress-y1a-brief.md`).
 */
import { basename } from 'node:path';
import type {
  CypressHook,
  CypressMochaEvent,
  CypressMochaEvents,
  CypressMochaRunner,
  CypressPluginConfig,
  CypressPluginEvents,
  CypressRunnable,
  CypressSuite,
  CypressTest,
} from '../../src/cypress.js';

/** What one attempt of a test ended with: `retry` stands for a failed attempt Cypress re-runs. */
export type FakeOutcome = 'pass' | 'fail' | 'retry' | 'pending';

/** One test of a fake spec: its attempts, in the order Cypress ran them. */
export interface FakeTest {
  title: string;
  attempts: FakeOutcome[];
  error?: string | undefined;
  duration?: number | undefined;
}

/** When the `beforeEach` of a `describe` fails: always, or on the first attempt only. */
export type FakeHookFailure = 'always' | 'once';

/** One `describe` of a fake spec. */
export interface FakeDescribe {
  title: string;
  tests?: FakeTest[] | undefined;
  describes?: FakeDescribe[] | undefined;
  beforeEachFails?: FakeHookFailure | undefined;
  /** The describe has an `after` hook, which Mocha reports as one after its last test. */
  afterAll?: boolean | undefined;
}

/** A fake spec: its tests outside any describe, and the describes they are in. */
export interface FakeSpec {
  tests?: FakeTest[] | undefined;
  describes?: FakeDescribe[] | undefined;
}

/** The plugin side: the handlers `probaraNodeEvents` registers, and the config it hands back. */
export interface FakePlugin {
  /** The `on` to hand `probaraNodeEvents`. */
  on: CypressPluginEvents;
  config: CypressPluginConfig;
  /** Calls every handler of `event`, in the order they were registered. */
  emit<E extends keyof PluginEventResults>(
    event: E,
    ...args: PluginEventResults[E]
  ): Promise<unknown[]>;
  /** A task the browser can call, by name. */
  task(name: string): ((...args: unknown[]) => unknown) | undefined;
  /** How many handlers an event has: how many times `setupNodeEvents` ran. */
  count(event: string): number;
}

/** What each event the plugin registers carries. */
export interface PluginEventResults {
  'before:run': [{ browser?: { name?: string } }];
  'before:spec': [{ relative: string }];
  'after:screenshot': [{ path: string }];
  'after:spec': [
    { relative: string },
    { stats?: { tests?: number; failures?: number }; video?: string | null },
  ];
  'after:run': [{ totalDuration?: number }];
}

type Handler = (...args: never[]) => unknown;

/** The `on` of a fake `setupNodeEvents`, and the config it returns. */
export function fakePlugin(config: Partial<CypressPluginConfig> = {}): FakePlugin {
  const handlers = new Map<string, Handler[]>();
  const tasks = new Map<string, Handler>();
  const given: CypressPluginConfig = {
    projectRoot: '/work/app',
    projectName: 'shop',
    isInteractive: false,
    expose: {},
    version: '16.1.1',
    env: {},
    ...config,
  };
  const on = ((event: string, handler: unknown): void => {
    if (event === 'task') {
      for (const [name, task] of Object.entries(handler as Record<string, Handler>)) {
        tasks.set(name, task);
      }
      return;
    }
    const list = handlers.get(event) ?? [];
    list.push(handler as Handler);
    handlers.set(event, list);
  }) as unknown as CypressPluginEvents;
  return {
    on,
    config: given,
    emit: async (event, ...args) => {
      const list = handlers.get(event) ?? [];
      const results: unknown[] = [];
      for (const handler of list) {
        results.push(await (handler as (...given: unknown[]) => unknown)(...args));
      }
      return results;
    },
    task: (name) => tasks.get(name) as ((...args: unknown[]) => unknown) | undefined,
    count: (event) => (handlers.get(event) ?? []).length,
  };
}

/** The Mocha runner of one spec, and the way a test emits its events on it. */
export interface FakeSpecRunner {
  runner: CypressMochaRunner;
  /** Calls every handler of `event` with `args`. */
  emit<E extends CypressMochaEvent>(event: E, ...args: CypressMochaEvents[E]): void;
}

/** The Mocha runner Cypress creates for the spec at `spec`. */
export function fakeRunner(spec: string): FakeSpecRunner {
  const handlers = new Map<string, Handler[]>();
  const root: CypressSuite = { title: '', root: true, file: spec, suites: [], tests: [] };
  const runner = {
    suite: root,
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return runner;
    },
  } as unknown as CypressMochaRunner;
  return {
    runner,
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        (handler as (...given: unknown[]) => void)(...args);
      }
    },
  };
}

/** A test of a fake spec that passes on its first attempt. */
export function passes(title: string, fake: Omit<FakeTest, 'title' | 'attempts'> = {}): FakeTest {
  return { title, attempts: ['pass'], ...fake };
}

/** A test that fails, and is not retried. */
export function fails(title: string, fake: Omit<FakeTest, 'title' | 'attempts'> = {}): FakeTest {
  return { title, attempts: ['fail'], ...fake };
}

/** A test that is skipped (`it.skip`): Cypress reports it pending, once, and no `test end`. */
export function skipped(title: string): FakeTest {
  return { title, attempts: ['pending'] };
}

/** A test that fails and passes on its retry: every attempt is a result of its own. */
export function flaky(title: string, fake: Omit<FakeTest, 'title' | 'attempts'> = {}): FakeTest {
  return { title, attempts: ['retry', 'pass'], ...fake };
}

/** A `describe` of a fake spec. */
export function suite(title: string, fake: Omit<FakeDescribe, 'title'> = {}): FakeDescribe {
  return { title, ...fake };
}

/** The runnable of an attempt, as the Mocha event of its outcome carries it. */
export function fakeRunnable(
  test: FakeTest,
  attempt: number,
  outcome: FakeOutcome,
): CypressRunnable {
  const error = outcome === 'fail' || outcome === 'retry' ? errorOf(test, false) : undefined;
  return {
    type: 'test',
    title: test.title,
    ...(test.duration === undefined ? {} : { duration: test.duration }),
    currentRetry: () => attempt,
    isPending: () => outcome === 'pending',
    ...(error === undefined ? {} : { err: error }),
  };
}

/** The hook Cypress runs before each test of a suite. */
export const BEFORE_EACH = '"before each" hook';

/** The hook Cypress runs once a suite's tests are done, before its `suite end`. */
export const AFTER_ALL = '"after all" hook';

/** Where the fake Cypress writes the screenshots and the video of the run. */
let assets = '/work/app/cypress';

/** Points the fake Cypress at a folder a test writes real files in: core uploads real files. */
export function assetsFolder(dir: string): void {
  assets = dir;
}

/** The path Cypress writes the screenshot of a failed attempt to. */
export function screenshotPath(
  spec: string,
  names: readonly string[],
  attempt: number,
  hook?: string,
): string {
  const base = [...names, ...(hook === undefined ? [] : [hook])].join(' -- ');
  const suffix = attempt === 1 ? ' (failed)' : ` (failed) (attempt ${String(attempt)})`;
  return `${assets}/screenshots/${basename(spec)}/${base}${suffix}.png`;
}

/** The video Cypress writes for a spec. */
export function videoPath(spec: string): string {
  return `${assets}/videos/${basename(spec)}.mp4`;
}

/**
 * Runs one fake spec on the runner Cypress would create for it, in the order a real run emits its
 * events: `start`, then each suite with its tests (`test`, its hooks, a screenshot, then the
 * outcome), then `suite end` of each suite and of the spec, then `end`.
 *
 * `beforeEachFails` makes the `beforeEach` of a suite throw: the attempt is reported by a `retry`
 * event naming the test while another attempt follows, and by a `fail` event naming the synthetic
 * hook test (`"before each" hook for "adds an item"`) when it is the last one.
 */
export function runSpec(
  events: FakeSpecRunner,
  spec: string,
  fake: FakeSpec,
  onScreenshot: (path: string) => void,
): void {
  events.emit('start');
  for (const test of fake.tests ?? []) {
    runTest(events, spec, test, [], undefined, { broken: false }, onScreenshot);
  }
  for (const nested of fake.describes ?? []) {
    const tests = nested.tests ?? [];
    const suiteOf: CypressSuite = {
      title: nested.title,
      root: false,
      file: null,
      suites: [],
      tests: tests.map((test) => ({ type: 'test', title: test.title })),
    };
    events.emit('suite', suiteOf);
    const suiteRun = { broken: false };
    for (const test of tests) {
      runTest(events, spec, test, [nested.title], nested.beforeEachFails, suiteRun, onScreenshot);
    }
    for (const deeper of nested.describes ?? []) {
      const deeperSuite: CypressSuite = {
        title: deeper.title,
        root: false,
        file: null,
        suites: [],
        tests: (deeper.tests ?? []).map((test) => ({ type: 'test', title: test.title })),
      };
      events.emit('suite', deeperSuite);
      const deeperRun = { broken: false };
      for (const test of deeper.tests ?? []) {
        runTest(
          events,
          spec,
          test,
          [nested.title, deeper.title],
          deeper.beforeEachFails ?? nested.beforeEachFails,
          deeperRun,
          onScreenshot,
        );
      }
      events.emit('suite end', deeperSuite);
    }
    if (nested.afterAll === true) {
      // Mocha runs the `after` hooks of a suite once its tests are done, before its `suite end`.
      const afterAll: CypressHook = { type: 'hook', title: AFTER_ALL };
      events.emit('hook', afterAll);
      events.emit('hook end', afterAll);
    }
    events.emit('suite end', suiteOf);
  }
  events.emit('suite end', { title: '', root: true, file: spec, suites: [], tests: [] });
  events.emit('end');
}

/** Runs one test and its attempts, the way Mocha does: `test`, its hooks, then its outcome. */
function runTest(
  events: FakeSpecRunner,
  spec: string,
  test: FakeTest,
  titles: string[],
  hookFailure: FakeHookFailure | undefined,
  suiteRun: { broken: boolean },
  onScreenshot: (path: string) => void,
): void {
  // A hook that fails on every attempt breaks the suite: Cypress skips the tests after it, and
  // they emit nothing at all.
  if (suiteRun.broken) return;
  test.attempts.forEach((outcome, index) => {
    const attempt = index;
    if (outcome === 'pending') {
      // Cypress reports a skipped test pending, before its `test` event, and no `test end`.
      const pendingRunnable = {
        ...fakeRunnable(test, attempt, outcome),
        type: 'test',
      } as CypressTest;
      events.emit('pending', pendingRunnable);
      events.emit('test', pendingRunnable);
      return;
    }
    const last = attempt === test.attempts.length - 1;
    const hookFails = hookFailure !== undefined && (hookFailure === 'always' || !last);
    events.emit('test', { ...fakeRunnable(test, attempt, outcome), type: 'test' });
    const hook: CypressHook = { type: 'hook', title: BEFORE_EACH };
    if (hookFailure !== undefined) {
      events.emit('hook', hook);
      if (!hookFails) events.emit('hook end', hook);
    }
    const failed = hookFails || outcome === 'fail' || outcome === 'retry';
    if (failed) {
      // Cypress names the file after the runnable that failed: the test itself while it is the
      // test that fails, the hook once it is the hook (which is what the last attempt reports).
      const afterHook = hookFails && (last || outcome === 'fail');
      onScreenshot(
        screenshotPath(
          spec,
          [...titles, test.title],
          attempt + 1,
          afterHook ? 'before each hook' : undefined,
        ),
      );
    }
    if (outcome === 'retry') {
      // The attempt failed and Cypress will run it again: it is reported by the `retry` event,
      // which names the test itself, even when a hook was what failed.
      events.emit('retry', fakeRunnable(test, attempt, outcome), errorOf(test, hookFails));
      return;
    }
    if (hookFails && last) {
      // Every attempt failed in the hook: Cypress reports the synthetic hook test, and the suite
      // emits nothing more for the tests after it.
      suiteRun.broken = hookFailure === 'always';
      events.emit('fail', syntheticHookTest(test), errorOf(test, true));
      events.emit('test end', fakeRunnable(test, attempt, 'fail'));
      return;
    }
    events.emit(outcome === 'pass' ? 'pass' : 'fail', fakeRunnable(test, attempt, outcome));
    events.emit('test end', fakeRunnable(test, attempt, outcome));
  });
}

/** The synthetic test Cypress reports a hook that failed on every attempt with. */
function syntheticHookTest(test: FakeTest): CypressRunnable {
  return {
    type: 'test',
    title: `${BEFORE_EACH} for "${test.title}"`,
    currentRetry: () => 1,
    err: errorOf(test, true),
  };
}

/** The error of a failed attempt, as Cypress builds its stack. */
function errorOf(test: FakeTest, hook: boolean): Error {
  const message = test.error ?? 'boom';
  const stack = hook
    ? `Error: ${message}\n\nBecause this error occurred during a \`beforeEach\` hook, we are skipping the remaining tests in this suite.`
    : `Error: ${message}\n  at spec`;
  return Object.assign(new Error(message), { stack });
}
