/** The Mocha reporter Cypress creates for each spec: it translates Mocha's events into results. */
import { realpathSync } from 'node:fs';
import { createAdapterSession, createReporter, logAdapterError } from '@probara/core';
/** The reporter process reads what the helpers said, the reporter side of the transport. */
import { ATTACH_LABEL, isAbout, labelOf } from './browser-message.js';
import type { AttemptDetails } from '@probara/core';
import type { CypressMochaRunner, CypressRunnable, CypressSuite } from './cypress.js';
import { fullTitleOf, type CypressTestNames } from './identity.js';
import { LOG_STREAM, type Setup } from './options.js';
import type { SessionLine, SpecResult, SpecResults } from './session-files.js';
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

/**
 * The warning of what a `probara.*` helper said with no test to say it of: one line per spec run,
 * naming every case it was dropped from. A helper in a suite-level `before` stamps no test, and one
 * called after its test ended names a test this spec never reported: neither is ever attributed to
 * another test.
 */
function droppedWarning(file: string, dropped: readonly string[]): string {
  const count = dropped.length;
  return `Left out ${String(count)} probara.* call${count === 1 ? '' : 's'} in ${file}: what it said belongs to no attempt that ran (${dropped.join(', ')})`;
}

/** A test a dropped line claimed, in a word: its full name, or the hook that runs no test. */
function quote(test: string): string {
  return test === '' ? 'a hook that runs no test' : `"${test}"`;
}

/**
 * Whether a line of the transport names a test: the browser's lines always do (an empty one is a
 * hook that runs no test), while core's `setup` and `selection` lines name only their file.
 */
function carriesTest(line: SessionLine): boolean {
  return typeof (line as { test?: unknown }).test === 'string';
}

/**
 * The helper a line of the transport came from, named with the test it claimed, for the warning
 * about a call that belongs to no attempt of `file`. `undefined` for a line of another spec, of a
 * file rather than a test, or of the file itself.
 */
function droppedLabel(line: SessionLine, file: string): string | undefined {
  if (line.file !== file || !carriesTest(line)) return undefined;
  const test = quote((line as { test: string }).test);
  if (line.type === 'attachment') return `${ATTACH_LABEL} of ${test}`;
  if (line.type !== 'message' && line.type !== 'step-start' && line.type !== 'step-end')
    return undefined;
  return `${labelOf(line)} of ${test}`;
}

/** Where a warning of the browser came from, in the run's log. */
function warningWhere(file: string, test: string | undefined): string {
  return test === undefined || test === '' ? file : `${file} › ${test}`;
}

/** One attempt, waiting for the end of its spec before it is sent with what its helpers said. */
interface PendingResult {
  test: CypressAttempt;
  startedAt: number;
  /** How many lines the transport held when this attempt began, and when the next one began. */
  from: number;
  to?: number | undefined;
  /** The screenshot Cypress named for this exact attempt, matched when the spec ends. */
  shot: { names: CypressTestNames; attempt: number; hook: string | undefined } | undefined;
}

/** What one spec run keeps while Mocha walks it. */
interface SpecState {
  /** The suite stack, the spec's root suite included. */
  stack: CypressSuite[];
  /** The names of the test that is running, its attempt number and when the attempt began. */
  current: { id: string; names: CypressTestNames; attempt: number; startedAt: number } | undefined;
  /** How many attempts of each test were reported, by {@link testIdOf}. */
  attempts: Map<string, number>;
  /** When each attempt of each test ended, by test id: a retry begins where the last one ended. */
  ended: Map<string, number>;
  /** The tests of the spec with a reported attempt: the rest are skipped at `suite end`. */
  reported: Set<string>;
  /** The results of the spec, waiting for its end (and for its video). */
  pending: PendingResult[];
  /** How many results the spec reported. */
  sent: number;
  /** The names of the screenshots Cypress took that belong to an attempt of this spec. */
  matched: Set<string>;
  /** How many lines of the transport an attempt of this spec took already. */
  consumed: number;
}

function newSpecState(): SpecState {
  return {
    stack: [],
    current: undefined,
    attempts: new Map(),
    ended: new Map(),
    reported: new Set(),
    pending: [],
    sent: 0,
    matched: new Set(),
    consumed: 0,
  };
}

/**
 * Sends every test result of a Cypress spec to Probara. Register it in the Cypress config:
 * `reporter: '@probara/cypress-reporter'` with `reporterOptions`. Cypress creates one of these per
 * spec, in the process its plugin runs in; it never throws into Cypress and never changes
 * Cypress's exit code: reporting failures are logged on stdout.
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
  /** How many lines of the plugin's transport an attempt of this spec took already. */
  private consumed = 0;
  /** This spec already warned about what the helpers said with no attempt to say it of. */
  private warnedDropped = false;

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
    // The window of this attempt opens here: whatever the helpers say from now on is its own, up
    // to the next attempt or the end of the spec (an `afterEach` of the test is still its own).
    this.openWindow();
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
    const { results, ignored, selection } = this.takeResults();
    if (this.plugin) {
      session.handOver({
        spec: this.spec,
        results,
        ignored,
        selection,
        warnings: session.takeWarnings(),
      });
      return;
    }
    // Without a plugin nobody hands them over: this process' own logger has them already.
    session.takeWarnings();
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
    this.state.ended.set(attemptId, Date.now());
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
      startedAt: this.startedAtOf(attemptId, runnable),
      from: this.state.consumed,
      shot: { names: reported, attempt, hook: hook?.hook },
    });
    // An attempt Cypress retries ends this window: whatever the helpers say from now on belongs to
    // the attempt that comes next, which is the same test with another attempt number.
    if (outcome === 'retry') this.openWindow();
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

  /**
   * When the attempt began. Cypress announces a test once, not once per attempt, so the attempts
   * after the first one begin where the attempt before them ended, which is what a retry does.
   */
  private startedAtOf(id: string, runnable: CypressRunnable): number {
    const attempt = this.attemptOf(id, runnable);
    if (attempt <= 1) return this.state.current?.startedAt ?? Date.now();
    return this.state.ended.get(id) ?? Date.now();
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
   * Opens the window of an attempt: everything the helpers say from now on belongs to it, up to the
   * attempt that comes next (the next `test`, or the retry of this one).
   */
  private openWindow(): void {
    const count = session.lineCount();
    const open = this.state.pending.at(-1);
    if (open !== undefined && open.to === undefined) open.to = count;
    this.state.consumed = count;
  }

  /**
   * What the `probara.*` helpers said about the attempt, and the screenshot Cypress took for it.
   *
   * The browser names the spec and the test in every message, never the attempt: the attempt is the
   * one whose window the line arrived in (between its `test` event and the next one), and a line
   * about another test, or with no test at all, is never handed to the attempt being built.
   */
  private detailsOf(
    pending: PendingResult,
    lines: readonly SessionLine[],
    used: Uint8Array,
    file: string,
  ): AttemptDetails {
    const names = pending.shot?.names ?? {
      suiteTitles: pending.test.suiteTitles,
      title: pending.test.title,
    };
    const test = fullTitleOf(names);
    const mine: SessionLine[] = [];
    const from = pending.from;
    const to = pending.to ?? lines.length;
    for (let index = from; index < to && index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined || !isAbout(line, file, test)) continue;
      used[index] = 1;
      mine.push(line);
    }
    const details = session.detailsOf(mine);
    if (this.setup?.attachScreenshots !== true || pending.shot === undefined) return details;
    const screenshot = this.screenshotOf(names, pending.shot.attempt, pending.shot.hook);
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
   * One warning per spec, whatever the number of calls that belong to no attempt, and the warnings
   * the browser sent about a wrong argument: every one of them once, naming where it came from.
   */
  private reportUnused(lines: readonly SessionLine[], used: Uint8Array, file: string): void {
    const dropped: string[] = [];
    for (const [index, line] of lines.entries()) {
      // A line of another spec, or one about the file rather than a test, belongs to no attempt.
      if (line.file !== file) continue;
      // A warning of the browser (a wrong argument) is the reporter's to log, once, wherever it
      // came from: it belongs to no attempt, and is never attributed to one.
      if (line.type === 'warning') {
        session.warnOnce(line.message, warningWhere(file, line.test));
        continue;
      }
      const label = droppedLabel(line, file);
      if (label === undefined || used[index] === 1) continue;
      dropped.push(label);
    }
    if (dropped.length > 0 && !this.warnedDropped) {
      this.warnedDropped = true;
      session.warnOnce(droppedWarning(file, dropped), file);
    }
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
   * owns. The screenshots are matched here, where everything the plugin wrote of the spec is known,
   * and the tests the run selection skipped are left out of the report. A result that cannot be
   * built is lost rather than thrown at Cypress, and the log says which.
   */
  /**
   * What the spec reported, handed over to the plugin process: its results, what `probara.ignore()`
   * left out, and what the run selection (`runCasesOnly`) left out of the report.
   */
  private takeResults(): {
    results: SpecResult[];
    ignored: number;
    selection: SpecResults['selection'];
  } {
    const { pending } = this.state;
    this.state.pending = [];
    const results: SpecResult[] = [];
    const all = session.pluginState().lines;
    /** The lines each attempt took, so what is left over is what belongs to none of them. */
    const used = new Uint8Array(all.length);
    const selection = session.selectionOf(this.spec);
    const deselected = new Set((selection?.deselected ?? []).map((names) => JSON.stringify(names)));
    /** Every distinct test the spec reported, the skipped ones among them: what the run counts. */
    const tests = new Set<string>();
    let skipped = 0;
    let ignored = 0;
    for (const attempt of pending) {
      try {
        const details = this.detailsOf(attempt, all, used, this.spec);
        const id = testIdOf(this.spec, attempt.test);
        tests.add(id);
        // A test the run selection skipped (`this.skip()` in the support file's `beforeEach`) is
        // reported by Cypress as pending: the report leaves it out, and counts it as skipped.
        if (deselected.has(JSON.stringify([...attempt.test.suiteTitles, attempt.test.title]))) {
          skipped += 1;
          continue;
        }
        for (const problem of details.problems) session.warnOnce(problem, titleOf(attempt.test));
        if (details.metadata.ignored) {
          ignored += 1;
          continue;
        }
        results.push({
          test: id,
          input: toResultInput(
            this.spec,
            attempt.test,
            this.context(attempt.test),
            attempt.startedAt,
            details,
          ),
        });
        this.state.sent += 1;
      } catch (error) {
        // A reporter must never break the test run: this attempt is lost, and the log says why.
        this.logError(
          `Could not report an attempt of ${titleOf(attempt.test)}: ${messageOf(error)}`,
        );
      }
    }
    // What the helpers said with no attempt of this spec to say it of: a suite hook that runs
    // before any test, or after the last one ended. It is dropped, with one warning naming it.
    this.reportUnused(all, used, this.spec);
    this.reportLeftOutScreenshots();
    return {
      results,
      ignored,
      selection:
        selection === undefined ? undefined : { run: selection.run, tests: tests.size, skipped },
    };
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
        // A test that never ran has no window of its own: nothing the helpers said is its own.
        from: session.lineCount(),
        to: session.lineCount(),
        shot: undefined,
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

  /** One error line on stdout, without the token, even before the setup is known. */
  private logError(message: string): void {
    logAdapterError(message, session.options(), session.logger(), LOG_STREAM);
  }
}

/**
 * The test a failing hook was running, and the name Cypress gave the hook, when the runnable of a
 * `fail` event is Cypress's synthetic hook test: `"before each" hook for "adds an item"` is the
 * `{ before each, adds an item }` of the hook that failed for that test.
 */
function hookFailureOf(runnable: CypressRunnable): { hook: string; test: string } | undefined {
  // Only the title tells a hook failure: Cypress reports it with a synthetic runnable that claims
  // to be a test, named after the hook and the test it was running.
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
  // A spec that ends while the one before it is still sending waits for it, never drops out.
  sending = [...(sending ?? []), ...specs.splice(0, specs.length)];
  const sendingNow = sending;
  if (sendingNow.length === 0) {
    sending = undefined;
    return;
  }
  const run = createReporter(setup.core);
  const adapter = createAdapterSession({
    logger: setup.core.logger,
    statusRules: setup.statusRules,
    projectCodes: setup.projectCodes,
  });
  for (const spec of sendingNow) {
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
  sending = undefined;
}

let sending: { spec: string; results: readonly SpecResult[]; ignored: number }[] | undefined;

/**
 * Forgets the specs this process reported on its own, and the send that is in flight: what a test
 * of this module starts from. A `cypress run` never needs it — one process reports one run, to the
 * one Probara of its options — but a test process runs many, each with a Probara of its own, and a
 * send left in flight would join the next one.
 */
export function resetOwnReports(): void {
  specs.length = 0;
  sending = undefined;
}

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
