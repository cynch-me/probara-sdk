/**
 * The parts of Cypress's reporter objects the reporter reads, as Cypress 12.17.4 and later hand
 * them over. Declared here rather than imported from `cypress`, which a project need not install
 * for its types to resolve (and whose own types are for the test files, not for a reporter): the
 * reporter's types then hold on every Cypress version of the peer range.
 *
 * Cypress drives Mocha for each spec and instantiates the reporter itself, once per spec, with
 * `new Reporter(runner, options)` in the Node process that runs `setupNodeEvents`.
 */

/** A suite of a spec: the root one (the spec itself), or a `describe`. */
export interface CypressSuite {
  /** `''` for the root suite, which holds the describes. */
  title: string;
  /** `true` for the root suite, whose title is the empty string. */
  root?: boolean | undefined;
  /**
   * The spec file, relative to `projectRoot` (`cypress/e2e/cart.cy.js`): only the root suite of a
   * spec holds it, its suites and tests hold `null`.
   */
  file?: string | null | undefined;
  /** The describes of this suite, in order. */
  suites?: readonly CypressSuite[] | undefined;
  /** The tests of this suite, in order, whatever their outcome. */
  tests?: readonly CypressTest[] | undefined;
}

/** A test or a hook, as Mocha's `pass`, `fail`, `pending`, `test end` and `retry` hand it over. */
export interface CypressRunnable {
  /** `'test'` for an `it`, `'hook'` for a `beforeEach` and the like. */
  type?: string | undefined;
  /** The test's own title, or a hook's (`"before each" hook`). */
  title: string;
  /**
   * The error, on the runnable of a failure. The runnable of a `retry` event is a serialized clone:
   * what it does not carry (like `currentRetry`) it has no method for.
   */
  err?: Error | undefined;
  /** Milliseconds, when the framework reports the runnable's own duration. */
  duration?: number | undefined;
  /** Which attempt this is, 0 for the first: absent on the clone of a `retry` event. */
  currentRetry?: (() => number) | undefined;
  /** Whether the test was skipped (`it.skip`, `this.skip()`). */
  isPending?: (() => boolean) | undefined;
}

/** An `it` of a spec. */
export interface CypressTest extends CypressRunnable {
  type?: 'test' | undefined;
}

/** A `beforeEach`, `afterEach`, `before` or `after` of a spec. */
export interface CypressHook extends CypressRunnable {
  type?: 'hook' | undefined;
}

/** What each Mocha event the reporter follows carries, in the order Cypress emits them. */
export interface CypressMochaEvents {
  start: [];
  suite: [suite: CypressSuite];
  'suite end': [suite: CypressSuite];
  test: [test: CypressTest];
  hook: [hook: CypressHook];
  'hook end': [hook: CypressHook];
  pass: [runnable: CypressRunnable];
  fail: [runnable: CypressRunnable, error: Error];
  pending: [runnable: CypressRunnable];
  'test end': [runnable: CypressRunnable];
  retry: [runnable: CypressRunnable, error: Error];
  end: [];
}

/** A Mocha event name. */
export type CypressMochaEvent = keyof CypressMochaEvents;

/** Every {@link CypressMochaEvent}, in the order Cypress emits them for one spec. */
export const MOCHA_EVENTS = [
  'start',
  'suite',
  'suite end',
  'test',
  'hook',
  'hook end',
  'pass',
  'fail',
  'pending',
  'test end',
  'retry',
  'end',
] as const satisfies readonly CypressMochaEvent[];

/** The Mocha runner Cypress creates for one spec, and hands the reporter. */
export interface CypressMochaRunner {
  /** The root suite of the spec, the only one that holds the spec file. */
  suite: CypressSuite;
  on<E extends CypressMochaEvent>(
    event: E,
    handler: (...args: CypressMochaEvents[E]) => void,
  ): CypressMochaRunner;
}

/** What `before:run` hands the plugin: the browser the run uses, and the specs it will run. */
export interface CypressBeforeRun {
  browser?: { name?: string | undefined } | undefined;
  specs?: readonly { relative: string }[] | undefined;
}

/** The statistics of one spec, from `after:spec`. */
export interface CypressSpecStats {
  tests?: number | undefined;
  failures?: number | undefined;
  passes?: number | undefined;
  pending?: number | undefined;
}

/** What `after:screenshot` hands the plugin: the file Cypress just wrote. */
export interface CypressScreenshotDetails {
  /** The path of the file, as Cypress named it. */
  path: string;
  /** Whether Cypress took it because the attempt failed. */
  testFailure?: boolean | undefined;
  /** The attempt it was taken in, from 0: the only part of a cut file name Cypress keeps apart. */
  testAttemptIndex?: number | undefined;
}

/** What `after:spec` hands the plugin: the spec, its statistics and its video. */
export interface CypressSpecResults {
  stats?: CypressSpecStats | undefined;
  /** The spec's video, only with `video: true`. */
  video?: string | null | undefined;
}

/** The part of the plugin config the reporter and `probaraNodeEvents` read. */
export interface CypressPluginConfig {
  /** The directory spec files are reported relative to. */
  projectRoot: string;
  /** The name of the project (`cypress.config.js`, or its folder). */
  projectName?: string | undefined;
  /** `cypress open`: one session, whose run stays open. */
  isInteractive?: boolean | undefined;
  /** `reporterOptions` of the Cypress config, as the user wrote it. */
  reporterOptions?: unknown;
  /** What the plugin and the support file expose to the browser (`Cypress.expose`). */
  expose?: Record<string, unknown> | undefined;
  /** The Cypress version running the tests. */
  version?: string | undefined;
  /** The `env` of the Cypress config, still on the Node side in Cypress 16. */
  env?: Record<string, unknown> | undefined;
}

/** What a handler of a plugin event may return: Cypress awaits a promise before it goes on. */
export type CypressPluginHandler = void | Promise<void>;

/** The `on` of `setupNodeEvents`: the events of the run, and the tasks the browser calls. */
export interface CypressPluginEvents {
  (event: 'before:run', handler: (details: CypressBeforeRun) => CypressPluginHandler): void;
  (event: 'before:spec', handler: (spec: { relative: string }) => CypressPluginHandler): void;
  (
    event: 'after:screenshot',
    handler: (details: CypressScreenshotDetails) => CypressPluginHandler,
  ): void;
  (
    event: 'after:spec',
    handler: (spec: { relative: string }, results: CypressSpecResults) => CypressPluginHandler,
  ): void;
  (
    event: 'after:run',
    handler: (results: { totalDuration?: number }) => CypressPluginHandler,
  ): void;
  (event: 'task', tasks: Record<string, (...args: never[]) => unknown>): void;
}
