/** The Mocha reporter Cypress creates for each spec: it translates Mocha's events into results. */
import { realpathSync } from 'node:fs';
import {
  createAdapterSession,
  createReporter,
  logAdapterError,
  type AttemptDetails,
} from '@probara/core';
import type { CypressMochaRunner, CypressRunnable, CypressSuite } from './cypress.js';
import type { CypressTestNames } from './identity.js';
import type { Setup } from './options.js';
import type { SpecResult } from './session-files.js';
import { session, type SpecReporter } from './session.js';
import {
  relativeFile,
  testIdOf,
  toResultInput,
  type CypressAttempt,
  type CypressOutcome,
  type TranslationContext,
} from './translate.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The title of a runnable for a log line, or a placeholder when even that fails. */
function titleOf(runnable: CypressRunnable): string {
  try {
    return `"${runnable.title}"`;
  } catch {
    return 'a test';
  }
}

/**
 * The synthetic test Cypress reports a failing hook with, as it names it on the `fail` event:
 * `"before each" hook for "adds an item"` — exactly what cypress-junit writes into the XML. The
 * reporter reports that title (so the key matches the import) and reads the test the hook was
 * running off it, which it then marks as reported so the walk of the suite invents no skipped
 * result for it.
 */
const HOOK_FAILURE = /^"(.+)" hook for "([^"]*)"$/;

/** How a failing hook of a test is named in the screenshot Cypress takes of it. */
const HOOK_SCREENSHOT_SUFFIX = ' hook';

/** The suffix Cypress names the screenshot of a failed attempt with, and of each retry after it. */
const FAILED_ATTEMPT = ' (failed)';

/**
 * The warning of a reporter without its plugin: no screenshots, no video and no `probara.*` task,
 * and the run completed on a safety net rather than at the end of the run.
 */
export const SETUP_MISSING =
  "Results are reported, but the screenshots, the videos and the probara.* helpers are not: add setupNodeEvents(on, config) { return probaraNodeEvents(on, config); } (from '@probara/cypress-reporter/setup') to the Cypress config, and require('@probara/cypress-reporter/support') in the support file";

/** One attempt, waiting for the end of its spec before it is sent with what its helpers said. */
interface PendingResult {
  test: CypressAttempt;
  startedAt: number;
  details: AttemptDetails;
}

/** What one spec run keeps while Mocha walks it. */
interface SpecState {
  /** The suite stack, the spec's root suite included. */
  stack: CypressSuite[];
  /** The names of the test that is running, its attempt number and when the attempt began. */
  current: { id: string; names: CypressTestNames; attempt: number; startedAt: number } | undefined;
  /** How many attempts of each test were reported, by {@link testIdOf}. */
  attempts: Map<string, number>;
  /** The tests of the spec with a reported attempt: the rest are skipped at `suite end`. */
  reported: Set<string>;
  /** The results of the spec, waiting for its end (and for its video). */
  pending: PendingResult[];
  /** How many results the spec reported. */
  sent: number;
  /** The names of the screenshots Cypress took that belong to an attempt of this spec. */
  matched: Set<string>;
}

function newSpecState(): SpecState {
  return {
    stack: [],
    current: undefined,
    attempts: new Map(),
    reported: new Set(),
    pending: [],
    sent: 0,
    matched: new Set(),
  };
}

/**
 * Sends every test result of a Cypress spec to Probara. Register it in the Cypress config:
 * `reporter: '@probara/cypress-reporter'` with `reporterOptions`. Cypress creates one of these per
 * spec, in the process its plugin runs in; it never throws into Cypress and never changes
 * Cypress's exit code: reporting failures are logged on stderr.
 */
export class ProbaraCypressReporter implements SpecReporter {
  /** The spec this reporter reports, relative to the project root. */
  readonly spec: string;
  private setup: Setup | undefined;
  private state: SpecState = newSpecState();
  /** Set once the results were handed to core: a spec never reports twice. */
  private flushed = false;
  /** The run has a plugin to send them, or this process sends them itself. */
  private plugin = true;
  /** How many lines of the plugin's transport the results of this spec took already. */
  private consumed = 0;

  constructor(runner?: CypressMochaRunner, options?: unknown) {
    this.spec = specOf(runner);
    try {
      // Without the plugin the reporter knows no project root: the working directory.
      this.setup = session.begin(options, realpathSync(process.cwd()));
      if (this.setup === undefined) return;
      const { plugin } = session.open();
      // Without a plugin nobody reads what this process writes, and Cypress kills it ~50 ms after
      // the last spec: it then reports the results itself, and holds the exit until they are sent.
      this.plugin = plugin;
      // Without a plugin, this process is the one that reports: Cypress kills it ~50 ms after the
      // last spec, so it holds the exit until what it collected is sent.
      if (!plugin) holdTheExit(() => completeSpecs(session));
      if (runner === undefined) return;
      session.setSpecReporter(this);
    } catch (error) {
      // A reporter must never break the test run: nothing is reported, and the log says why.
      this.setup = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
  }

  start(): void {
    this.state.stack = [];
  }

  suite(suite: CypressSuite): void {
    this.state.stack.push(suite);
  }

  /** Closes a suite: every test of it that reported no attempt never ran, and is skipped. */
  'suite end'(suite: CypressSuite): void {
    this.skipUnreported(suite);
    const index = this.state.stack.lastIndexOf(suite);
    if (index !== -1) this.state.stack.length = index;
  }

  /** A test starts an attempt: what the `probara.*` calls of the browser belong to. */
  test(runnable: CypressRunnable): void {
    const names = this.namesOf(runnable);
    const id = testIdOf(this.spec, names);
    const attempt = (this.state.attempts.get(id) ?? 0) + 1;
    this.state.current = { id, names, attempt, startedAt: Date.now() };
  }

  hook(): void {
    // A hook is no test of its own: what it did belongs to the test it runs for.
  }

  'hook end'(): void {
    // Only the outcome of a test is a result.
  }

  pass(runnable: CypressRunnable): void {
    this.outcome('pass', runnable);
  }

  fail(runnable: CypressRunnable, error?: Error): void {
    this.outcome('fail', runnable, error);
  }

  pending(runnable: CypressRunnable): void {
    this.outcome('pending', runnable);
  }

  'test end'(): void {
    // The outcome came first, and a pending test sends no `test end` at all.
  }

  /** The attempt Cypress failed and is about to run again: a result of its own, like a failure. */
  retry(runnable: CypressRunnable, error?: Error): void {
    this.outcome('retry', runnable, error);
  }

  /**
   * The spec ended: its results are built (with the browser and the screenshots the plugin left)
   * and handed over, which is where they are sent from.
   */
  end(): void {
    if (this.flushed) return;
    if (this.setup === undefined) return;
    this.flushed = true;
    const { results, ignored } = this.takeResults();
    if (this.plugin) {
      session.handOver({ spec: this.spec, results, ignored });
      return;
    }
    // A run whose Cypress config registers no `setupNodeEvents`: nobody reads what this process
    // writes, so it sends the spec's results itself, in a run of its own.
    session.warnOnce(SETUP_MISSING, this.relativeFile());
    sendSpecRun(this.setup, this.spec, results, ignored);
  }

  /** How many results of this spec were built. */
  get sent(): number {
    return this.state.sent;
  }

  /** Reports the test `runnable` ended with, as the Mocha event `outcome` names it. */
  private outcome(outcome: CypressOutcome, runnable: CypressRunnable, eventError?: Error): void {
    const setup = this.setup;
    if (setup === undefined) return;
    // A failing hook is reported with Cypress's synthetic test, whose title is what cypress-junit
    // writes; `attempt` names the test the hook was really running, whose attempt it continues.
    const hook = hookFailureOf(runnable);
    const names = this.namesOf(runnable);
    const id = testIdOf(this.spec, names);
    const reported =
      hook === undefined ? names : { suiteTitles: names.suiteTitles, title: hook.test };
    const attemptId = testIdOf(this.spec, reported);
    const attempt = this.attemptOf(attemptId, runnable);
    this.state.attempts.set(attemptId, attempt);
    this.state.reported.add(id);
    this.state.reported.add(attemptId);
    const duration = typeof runnable.duration === 'number' ? runnable.duration : undefined;
    const failure = outcome === 'pending' ? undefined : (runnable.err ?? eventError);
    const test: CypressAttempt = {
      suiteTitles: names.suiteTitles,
      title: names.title,
      outcome,
      attempt,
      ...(duration === undefined ? {} : { durationMs: duration }),
      ...(failure === undefined ? {} : { error: failure }),
    };
    this.state.pending.push({
      test,
      startedAt: this.state.current?.startedAt ?? Date.now(),
      details: this.detailsOf(reported, attempt, hook?.hook),
    });
  }

  /** The titles of the test `runnable` is in: the suite stack, then its own title. */
  private namesOf(runnable: CypressRunnable): CypressTestNames {
    const suiteTitles = this.suiteTitles();
    try {
      return { suiteTitles, title: runnable.title };
    } catch {
      return { suiteTitles, title: '' };
    }
  }

  /** The titles of the suites the runner is in, the root suite of the spec excluded. */
  private suiteTitles(): string[] {
    return this.state.stack.filter((suite) => suite.root !== true).map((suite) => suite.title);
  }

  /** Which attempt of a test this is: `currentRetry() + 1`, or one more than the last reported. */
  private attemptOf(id: string, runnable: CypressRunnable): number {
    const last = this.state.attempts.get(id) ?? 0;
    try {
      // The runnable of a `retry` event is a serialized clone, with no method to call.
      if (typeof runnable.currentRetry === 'function') return runnable.currentRetry() + 1;
    } catch {
      // Fall through to the count of what was reported.
    }
    return last + 1;
  }

  /**
   * What the `probara.*` helpers said about the attempt (through `cy.task`) and the screenshot
   * Cypress took for it.
   */
  private detailsOf(
    names: CypressTestNames,
    attempt: number,
    hook: string | undefined,
  ): AttemptDetails {
    // The plugin writes what the helpers said as it happens: whatever arrived since the last attempt
    // ended belongs to this one (Cypress awaits a `cy.task` before the test ends).
    const lines = session.pluginState().lines;
    const mine = lines.slice(this.consumed);
    this.consumed = lines.length;
    const details = session.detailsOf(mine);
    if (this.setup?.attachScreenshots !== true) return details;
    const screenshot = this.screenshotOf(names, attempt, hook);
    if (screenshot === undefined) return details;
    return {
      ...details,
      attachments: [
        ...details.attachments,
        {
          path: screenshot.path,
          name: `${screenshot.name}.png`,
          // Typed, so Probara converts it as the image it is (and not as an opaque file).
          contentType: 'image/png',
        },
      ],
    };
  }

  /**
   * The screenshot of this exact attempt. Cypress names it after the test: its titles joined by
   * ` -- `, then ` (failed)`, then ` (attempt N)` for a retry; a failing hook is named after the
   * hook, after the test it was running. A screenshot naming neither belongs to no attempt: it is
   * left out, and {@link reportLeftOutScreenshots} says so once at debug.
   */
  private screenshotOf(
    names: CypressTestNames,
    attempt: number,
    hook: string | undefined,
  ): { path: string; name: string } | undefined {
    const base = [...names.suiteTitles, names.title].join(' -- ');
    const suffix =
      attempt === 1 ? FAILED_ATTEMPT : `${FAILED_ATTEMPT} (attempt ${String(attempt)})`;
    const wanted =
      hook === undefined
        ? `${base}${suffix}`
        : `${base} -- ${hook}${HOOK_SCREENSHOT_SUFFIX}${suffix}`;
    this.state.matched.add(wanted);
    const shots = session.screenshotsOf(this.spec);
    return shots.find((shot) => shot.name === wanted);
  }

  /**
   * Every result the spec holds, as core takes them: what the plugin process sends with the run it
   * owns. The screenshots are matched here, where everything the plugin wrote of the spec is known.
   * A result that cannot be built is lost rather than thrown at Cypress, and the log says which.
   */
  private takeResults(): { results: SpecResult[]; ignored: number } {
    const { pending } = this.state;
    this.state.pending = [];
    const results: SpecResult[] = [];
    let ignored = 0;
    for (const { test, startedAt, details } of pending) {
      try {
        for (const problem of details.problems) session.warnOnce(problem, titleOf(test));
        if (details.metadata.ignored) {
          ignored += 1;
          continue;
        }
        results.push({
          test: testIdOf(this.spec, test),
          input: toResultInput(this.spec, test, this.context(test), startedAt, details),
        });
        this.state.sent += 1;
      } catch (error) {
        // A reporter must never break the test run: this attempt is lost, and the log says why.
        this.logError(`Could not report an attempt of ${titleOf(test)}: ${messageOf(error)}`);
      }
    }
    this.reportLeftOutScreenshots();
    return { results, ignored };
  }

  /** One debug line for every screenshot of the spec that belongs to no failed attempt. */
  private reportLeftOutScreenshots(): void {
    if (this.setup?.attachScreenshots !== true) return;
    const left = session
      .screenshotsOf(this.spec)
      .filter((shot) => !this.state.matched.has(shot.name));
    if (left.length === 0) return;
    session
      .logger()
      ?.debug(
        `Left out the screenshots of ${this.relativeFile()} that name no failed test: ${left.map((shot) => shot.name).join(', ')}`,
      );
  }

  /** Every test of `suite` with no reported attempt never ran: a failing hook kept it from running. */
  private skipUnreported(suite: CypressSuite): void {
    if (this.setup === undefined) return;
    const titles = this.suiteTitlesOf(suite);
    const skipped = (test: { title: string }): void => {
      const names: CypressTestNames = { suiteTitles: titles, title: test.title };
      const id = testIdOf(this.spec, names);
      if (this.state.reported.has(id)) return;
      this.state.reported.add(id);
      const attempt = (this.state.attempts.get(id) ?? 0) + 1;
      this.state.pending.push({
        test: { ...names, outcome: 'pending', attempt },
        startedAt: Date.now(),
        details: session.detailsOf([]),
      });
    };
    for (const test of suite.tests ?? []) skipped(test);
    for (const nested of suite.suites ?? []) {
      // The nested suites keep the titles of the suites above them.
      this.state.stack.push(nested);
      this.skipUnreported(nested);
      this.state.stack.pop();
    }
  }

  /** The titles of the suites a test of `suite` is in, the root suite of the spec excluded. */
  private suiteTitlesOf(suite: CypressSuite): string[] {
    const titles: string[] = [];
    for (const each of this.state.stack) {
      if (each.root === true) continue;
      titles.push(each.title);
      if (each === suite) return titles;
    }
    return titles;
  }

  /** The options of a result of this spec: what core, the setup and the helpers of the run said. */
  private context(test: CypressAttempt): TranslationContext {
    const setup = this.setup;
    return {
      projectCodes: setup?.projectCodes ?? [],
      keyIncludesFile: setup?.keyIncludesFile ?? true,
      rootDir: setup?.core.rootDir ?? process.cwd(),
      issueUrlTemplate: setup?.issueUrlTemplate,
      browserAsParameter: setup?.browserAsParameter === true,
      browser: session.pluginState().browser,
      warn: (message) => {
        session.warnOnce(message, titleOf(test));
      },
    };
  }

  private relativeFile(): string {
    return relativeFile(this.spec, this.setup?.core.rootDir ?? process.cwd());
  }

  /** One error line on stderr, without the token, even before the setup is known. */
  private logError(message: string): void {
    logAdapterError(message, session.options(), session.logger());
  }
}

/**
 * The test a failing hook was running, and the name Cypress gave the hook, when the runnable of a
 * `fail` event is Cypress's synthetic hook test: `"before each" hook for "adds an item"` is the
 * `{ before each, adds an item }` of the hook that failed for that test.
 */
function hookFailureOf(runnable: CypressRunnable): { hook: string; test: string } | undefined {
  if (runnable.type === 'test') return undefined;
  let title: string;
  try {
    title = runnable.title;
  } catch {
    return undefined;
  }
  const match = HOOK_FAILURE.exec(title);
  if (match === null) return undefined;
  return { hook: match[1] ?? '', test: match[2] ?? title };
}

/**
 * Sends the results of one spec in a run of its own, and closes that run: what a Cypress config
 * that registers no `setupNodeEvents` can do. Cypress never tells the reporter process when such a
 * run ends, so each spec reports as it ends rather than lose what it collected.
 */
function sendSpecRun(
  setup: Setup,
  spec: string,
  results: readonly SpecResult[],
  ignored: number,
): void {
  specs.push({ spec, results, ignored });
  void sendWhatIsCollected(setup);
}

/** Every spec this process reported on its own, in the order they ended. */
const specs: { spec: string; results: readonly SpecResult[]; ignored: number }[] = [];

/**
 * Sends what this process collected, once: every spec that reported on its own, in one run. The
 * last spec's results are the ones Cypress would cut short, so they go out as soon as it is done.
 */
async function sendWhatIsCollected(setup: Setup): Promise<void> {
  if (sending) return;
  sending = specs.splice(0, specs.length);
  const run = createReporter(setup.core);
  const adapter = createAdapterSession({
    logger: setup.core.logger,
    statusRules: setup.statusRules,
    projectCodes: setup.projectCodes,
  });
  for (const spec of sending) {
    for (let index = 0; index < spec.ignored; index += 1) adapter.countIgnored();
    for (const { test, input } of spec.results) {
      adapter.count(input, test);
      run.addResult(input);
    }
  }
  try {
    if (run.enabled) {
      const line = adapter.summaryLine();
      if (line !== undefined) setup.core.logger?.info(line);
    }
    await run.complete();
  } catch (error) {
    setup.core.logger?.error(
      `Could not report a spec without setupNodeEvents: ${messageOf(error)}`,
    );
  }
  sending = [];
}

let sending: { spec: string; results: readonly SpecResult[]; ignored: number }[] | undefined;

/**
 * Holds this process open until what it has to send is sent: Cypress ends the process that drives
 * the specs with an explicit `process.exit`, which no `beforeExit` hook ever sees. Bounded, so a
 * Probara that never answers delays the exit by at most `EXIT_GRACE_MS` and never hangs the run.
 */
function holdTheExit(report: () => Promise<void>): void {
  const exit = process.exit.bind(process);
  process.exit = (code?: number | string | null): never => {
    const done = (): void => {
      exit(code);
    };
    const grace = setTimeout(done, EXIT_GRACE_MS);
    grace.unref();
    void report()
      .catch(() => undefined)
      .then(() => {
        clearTimeout(grace);
        done();
      });
    return undefined as never;
  };
}

/** How long the exit of a run without a plugin waits for its results, at most. */
const EXIT_GRACE_MS = 30_000;

/** The specs this process reported on its own are sent when it is about to end. */
function completeSpecs(current: typeof session): Promise<void> {
  const setup = current.resolved();
  return setup === undefined ? Promise.resolve() : sendWhatIsCollected(setup);
}

/** The spec the runner walks: its root suite holds the file, relative to the project root. */
function specOf(runner: CypressMochaRunner | undefined): string {
  try {
    const file = runner?.suite.file;
    return typeof file === 'string' ? file : '';
  } catch {
    return '';
  }
}
