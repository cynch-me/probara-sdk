/** The Jest reporter: translates Jest's events into `@probara/core` results. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createAdapterSession,
  createReporter,
  listRunCaseKeys,
  logAdapterError,
  redact,
  reuseRuns,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
  type ReportError,
  type ReportSummary,
} from '@probara/core';
import {
  attemptKey,
  CHANNEL_VARIABLE,
  writeSettings,
  type RunSelection,
  type SelectionFailure,
} from './channel.js';
import {
  createChannel,
  type AttemptDetails,
  type Channel,
  type ChannelWarning,
} from './channel-reader.js';
import type { JestAttempt, JestCaseStart, JestFileResult, JestTest } from './jest.js';
import { resolveSetup, type ProbaraJestOptions, type Setup } from './options.js';
import { namesProject } from './identity.js';
import { createSelector, type Selector } from './selection.js';
import { relativeFile, testIdOf, toResultInput, type TranslationContext } from './translate.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The title of an attempt for a log line, or a placeholder when even that fails. */
function titleOf(attempt: JestAttempt): string {
  try {
    return `"${attempt.title}"`;
  } catch {
    return 'a test';
  }
}

/** The first line of a message that says something. */
function firstLine(message: string): string {
  return (
    message
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/**
 * The title of the failed test jest-junit adds to a file that failed outside its tests (an
 * `afterAll` hook that throws, an unhandled error) while its tests ran, under an empty describe.
 */
const OUTSIDE_TESTS_FAILURE =
  "Test execution failure: could be caused by test hooks like 'afterAll'.";

/** The warning of `captureOutput` in a test file the setup file did not run in. */
const SETUP_MISSING =
  "captureOutput needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config";

/** The warning of `runCasesOnly` in a test file the setup file did not run in. */
const SELECTION_SETUP_MISSING =
  "runCasesOnly needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config. Every test of a file without it runs and is reported";

/** What each reason the setup file could not skip the tests of a file says. */
const SELECTION_FAILURE_REASONS: Readonly<Record<SelectionFailure, string>> = {
  'no-hook': 'no beforeAll hook of Jest to register',
  'no-circus': "the test runner is not jest-circus, Jest's default",
  failed: 'its selection failed',
};

/** The warning of `runCasesOnly` in a test file the setup file could not skip tests in. */
function selectionNotApplied(failure: SelectionFailure): string {
  return `runCasesOnly: the setup file could not skip the tests of a file that match no case of the run (${SELECTION_FAILURE_REASONS[failure]}). Every test of such a file runs and is reported`;
}

/** The warning of `runCasesOnly` without a run to take the tests from. */
const SELECTION_RUN_MISSING =
  'runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported';

/** The warning of `runCasesOnly` when the cases of the run cannot be read. */
function selectionFailed(run: string, reason: string): string {
  return `runCasesOnly: could not read the cases of the run ${run} (${reason}). Every test runs and is reported`;
}

/** The ULID of the run `runCasesOnly` takes the tests from: `run.ulid`, else `PROBARA_RUN_ULID`. */
function selectionRunOf(setup: Setup): string {
  const { run, env } = setup.core;
  const given = run?.ulid ?? (env ?? process.env).PROBARA_RUN_ULID ?? '';
  return given.trim().toUpperCase();
}

/** The attempt number of an attempt: 1 for the first, 2 for the first retry... */
function attemptOf(attempt: JestAttempt): number {
  const invocations = attempt.invocations ?? 1;
  return invocations > 1 ? invocations : 1;
}

/**
 * An attempt as a file result lists it: the test, its status and its attempt number. A file result
 * lists the last attempt of each test, which `onTestCaseResult` reported already, except for the
 * tests that never ran (skipped): only those match no reported attempt.
 */
function outcomeOf(path: string, attempt: JestAttempt): string {
  return JSON.stringify([testIdOf(path, attempt), attempt.status, attemptOf(attempt)]);
}

/** The name of a Jest project's `displayName` (`{ name, color }`, or a string), if it has one. */
function displayNameOf(displayName: unknown): string | undefined {
  if (typeof displayName === 'string') return displayName;
  if (typeof displayName !== 'object' || displayName === null) return undefined;
  const { name } = displayName as { name?: unknown };
  return typeof name === 'string' ? name : undefined;
}

/** The Jest project of `test` (the `id` Jest gives each project), `''` when it has none. */
function projectOf(test: JestTest): string {
  try {
    const id = test.context?.config?.id;
    return typeof id === 'string' ? id : '';
  } catch {
    return '';
  }
}

/** How an attempt of a test appears in a log line: `"cart adds" attempt 2`. */
function attemptLabelOf(key: string): string {
  try {
    const [, test, attempt] = JSON.parse(key) as [unknown, unknown, unknown];
    return `${JSON.stringify(test)} attempt ${String(attempt)}`;
  } catch {
    return key;
  }
}

/**
 * The runs of the watch session of this process, by project code. In watch mode (`--watch`,
 * `--watchAll`) Jest creates a new reporter for each re-run, in the same process, where this module
 * stays loaded: the first re-run with results creates the run of a project, and every later one
 * reports into it.
 */
const watchRuns = new Map<string, { ulid: string; displayId: string }>();

/** Whether Jest runs in watch mode: `--watch` or `--watchAll`. */
function isWatchMode(globalConfig: unknown): boolean {
  try {
    if (typeof globalConfig !== 'object' || globalConfig === null) return false;
    const { watch, watchAll } = globalConfig as { watch?: unknown; watchAll?: unknown };
    return watch === true || watchAll === true;
  } catch {
    return false;
  }
}

/**
 * The options of a report of the watch session: into the runs it has, and never closing one (a
 * closed run would refuse the next re-run).
 */
function watchOptionsOf(core: ReporterOptions): ReporterOptions {
  const runs = Object.fromEntries([...watchRuns].map(([code, run]) => [code, run.ulid]));
  const options = watchRuns.size === 0 ? core : reuseRuns(core, runs);
  return { ...options, closeRun: false, closeRuns: undefined };
}

/**
 * How the run of a project's reports went away, from their errors (a watch session never closes a
 * run, so they are the reports' own): `closed` (409 `conflict`, not retried) or `deleted` (404
 * `not_found`); `undefined` for any other failure. A 409 that was retried (`Retry-After`: the same
 * report was still in flight) is no refusal: that report may be recorded, so it is never sent again.
 */
function refusalOf(errors: readonly ReportError[]): 'closed' | 'deleted' | undefined {
  const refused = (status: number, code: string) =>
    errors.some(
      (error) => error.status === status && error.code === code && error.retryable === false,
    );
  if (refused(409, 'conflict')) return 'closed';
  if (refused(404, 'not_found')) return 'deleted';
  return undefined;
}

/** Whether an attempt ran: it passed or failed (not skipped, nor a todo). */
function ran(attempt: JestAttempt): boolean {
  return attempt.status === 'passed' || attempt.status === 'failed';
}

/** Whether an attempt that did not run is one of `skipped`, the tests the setup file skipped. */
function isSkippedIn(skipped: Set<string>, path: string, attempt: JestAttempt): boolean {
  return !ran(attempt) && skipped.has(testIdOf(path, attempt));
}

/** An attempt Jest reported, waiting for the end of its file to be sent with its details. */
interface PendingAttempt {
  path: string;
  attempt: JestAttempt;
  startedAt: number;
}

/**
 * The key of the channel lines of an attempt: its file, Jest's full name, its attempt number. The
 * test process builds the same key from Jest's own state (`currentTest()` in `current-test.ts`):
 * both must stay byte for byte the same, or an attempt silently loses what its helpers said. The
 * full name joins the describes and the title with spaces, so two tests of a file can share it
 * (`test.each` rows without a placeholder, "a b" › "c" and "a" › "b c"): such attempts get no
 * details at all ({@link ProbaraJestReporter.reportPending}), never each other's.
 */
function channelKeyOf(path: string, attempt: JestAttempt): string {
  return attemptKey(path, [...attempt.ancestorTitles, attempt.title].join(' '), attemptOf(attempt));
}

/**
 * What the reporter keeps of one test file (a path) while Jest runs it. Jest may run one path in
 * several projects at once (`projects` whose `testMatch` overlap): each run has its own start, but
 * Jest's case events name no project (they carry the first project's context), so what they report
 * is kept by path, and the state goes once the last run of the path ends.
 */
interface FileState {
  /** The runs of the file Jest began and has not ended, oldest first. */
  runs: { project: string; displayName: string | undefined; start: number }[];
  /**
   * Whether Jest ran the file in several projects at once: the helper lines of both runs then
   * share their keys, and no line tells its project (the test side cannot see it).
   */
  overlapped: boolean;
  /** When each attempt of each test started, oldest first (`onTestCaseStart`). */
  starts: Map<string, number[]>;
  /** How many attempts of each {@link outcomeOf} `onTestCaseResult` reported. */
  reported: Map<string, number>;
}

/**
 * Sends every test result of a Jest run to Probara. Register it in the Jest config:
 * `reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]]`. It never throws into
 * Jest and never changes Jest's exit code: reporting failures are logged on stderr.
 */
export class ProbaraJestReporter {
  private readonly options: ProbaraJestOptions;
  /** Jest runs in watch mode: one Probara run per watch session ({@link watchRuns}). */
  private readonly watch: boolean;
  private setup: Setup | undefined;
  private probara: ProbaraReporter | undefined;
  private context: TranslationContext = { projectCodes: [], keyIncludesFile: true, rootDir: '' };
  private logger: Logger | undefined;
  /** What was handed to core, for the `Sending N results` line, and the warnings given once. */
  private session: AdapterSession = createAdapterSession();
  private readonly files = new Map<string, FileState>();
  /** The attempts Jest reported, in order, until the end of their file. */
  private pending: PendingAttempt[] = [];
  /** Where the `probara.*` helpers of the test processes write, while the run lasts. */
  private channel: Channel | undefined;
  /**
   * The run whose tests alone run (`runCasesOnly`), once the setup file got its cases, and how
   * many tests of the files it ran in matched them.
   */
  /**
   * `runCasesOnly`: the run, its selector, and the tests of the files it ran in: all of them, those
   * skipped and left out, and those that ran and were left out (their names hold `{displayName}`).
   */
  private selection:
    { run: string; selects: Selector; tests: number; skipped: number; ran: number } | undefined;
  /** What the channel variable held before the run, restored after it. */
  private outerChannel: { value: string | undefined } | undefined;
  private readonly closeOnExit = (): void => {
    this.closeChannel();
  };

  /** Jest calls it with its global config and the reporter options (and a context it needs not). */
  constructor(globalConfig?: unknown, options: ProbaraJestOptions = {}) {
    this.options = options;
    this.watch = isWatchMode(globalConfig);
    try {
      const given: unknown = options;
      if (typeof given !== 'object' || given === null) return;
      // jest-junit writes paths relative to the real path of the working directory.
      const setup = resolveSetup(options, realpathSync(process.cwd()));
      this.setup = setup;
      this.logger = setup.core.logger;
      this.context = {
        projectCodes: setup.projectCodes,
        keyIncludesFile: setup.keyIncludesFile,
        rootDir: resolve(setup.core.rootDir ?? process.cwd()),
        issueUrlTemplate: setup.issueUrlTemplate,
      };
      this.session = createAdapterSession({
        logger: setup.core.logger,
        statusRules: setup.statusRules,
        projectCodes: setup.projectCodes,
      });
      for (const warning of setup.warnings) this.logger?.warn(warning);
    } catch (error) {
      // A reporter must never break the test run: nothing is reported, and the log says why.
      this.setup = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
  }

  /**
   * Jest awaits it before it starts its test processes: with `runCasesOnly`, the cases of the run
   * are read here, and handed to the setup file of every test process with the channel. Never
   * rejects.
   */
  async onRunStart(): Promise<void> {
    // A run of watch mode starts afresh: files an interrupted run began and never ended are gone.
    this.files.clear();
    this.pending = [];
    try {
      const options: unknown = this.options;
      if (typeof options !== 'object' || options === null) {
        // Core turns reporting off with a problem for options that are not an object.
        this.probara = createReporter(options as ReporterOptions);
        return;
      }
      if (this.setup !== undefined) {
        const core = this.setup.core;
        this.probara = createReporter(this.watch ? watchOptionsOf(core) : core);
      }
    } catch (error) {
      this.probara = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
    // Without runCasesOnly nothing is awaited: the channel opens as Jest calls this hook.
    const selection = this.setup?.runCasesOnly === true ? await this.readSelection() : undefined;
    this.openChannel(selection);
  }

  /**
   * The cases of the run `runCasesOnly` takes the tests from, or `undefined` (after one warning)
   * when they cannot be read: every test then runs and is reported. Never rejects.
   */
  private async readSelection(): Promise<RunSelection | undefined> {
    const setup = this.setup;
    // Reporting is off: nothing is reported, and every test runs.
    if (setup === undefined || this.probara?.acceptsResults !== true) return undefined;
    let run = '';
    try {
      run = selectionRunOf(setup);
      if (run === '') {
        this.logger?.warn(SELECTION_RUN_MISSING);
        return undefined;
      }
      const summary = await listRunCaseKeys({ ...setup.core, run: { ulid: run } });
      if (summary.status !== 'listed') {
        this.logger?.warn(
          selectionFailed(run, summary.error?.message ?? 'reporting to Probara is off'),
        );
        return undefined;
      }
      return {
        run,
        keys: summary.cases.flatMap(({ automationKey }) =>
          automationKey === null ? [] : [automationKey],
        ),
        caseIds: summary.cases.map(({ caseDisplayId }) => caseDisplayId),
        projectCodes: [...this.context.projectCodes],
        keyIncludesFile: this.context.keyIncludesFile,
        rootDir: this.context.rootDir,
      };
    } catch (error) {
      // Only a guard: core refuses a malformed run.ulid, and listRunCaseKeys never rejects.
      const { apiToken, env } = setup.core;
      const secrets = [apiToken, (env ?? process.env).PROBARA_API_TOKEN].filter(
        (secret): secret is string => typeof secret === 'string' && secret !== '',
      );
      this.logger?.warn(
        selectionFailed(
          run || 'of run.ulid or PROBARA_RUN_ULID',
          redact(messageOf(error), secrets),
        ),
      );
      return undefined;
    }
  }

  onTestFileStart(test: JestTest): void {
    try {
      const file = this.fileOf(test.path);
      if (file.runs.length > 0) file.overlapped = true;
      file.runs.push({
        project: projectOf(test),
        displayName: displayNameOf(test.context?.config?.displayName),
        start: Date.now(),
      });
    } catch (error) {
      this.logError(`Could not follow a test file: ${messageOf(error)}`);
    }
  }

  /** Called before each attempt of a test that runs (never for a skipped one, nor a todo). */
  onTestCaseStart(test: JestTest, start: JestCaseStart): void {
    try {
      const starts = this.fileOf(test.path).starts;
      const id = testIdOf(test.path, start);
      const list = starts.get(id) ?? [];
      list.push(typeof start.startedAt === 'number' ? start.startedAt : Date.now());
      starts.set(id, list);
    } catch (error) {
      this.logError(`Could not follow the start of a test: ${messageOf(error)}`);
    }
  }

  /**
   * Called once per attempt: every retry is a result of its own, in attempt order. It is sent once
   * its file ends, with what the `probara.*` helpers said about it by then.
   */
  onTestCaseResult(test: JestTest, attempt: JestAttempt): void {
    try {
      const file = this.fileOf(test.path);
      const id = testIdOf(test.path, attempt);
      // Paired with its start even when the result carries one (Jest 30), to keep the order.
      const started = file.starts.get(id)?.shift();
      const outcome = outcomeOf(test.path, attempt);
      file.reported.set(outcome, (file.reported.get(outcome) ?? 0) + 1);
      const startedAt = typeof attempt.startedAt === 'number' ? attempt.startedAt : started;
      if (this.probara?.acceptsResults !== true) return;
      this.pending.push({
        path: test.path,
        attempt,
        startedAt: startedAt ?? file.runs[0]?.start ?? Date.now(),
      });
    } catch (error) {
      // A reporter must never break the test run: this attempt is lost, and the log says why.
      this.logError(`Could not report an attempt of ${titleOf(attempt)}: ${messageOf(error)}`);
    }
  }

  /**
   * Called once a file ends, with the last attempt of each of its tests: its attempts are sent with
   * what the helpers said, then those `onTestCaseResult` never saw (skipped tests). A file that
   * failed outside its tests while they ran (an `afterAll` hook that throws) also gets the failed
   * test jest-junit writes for it, so Probara never shows it green. A file Jest could not run has
   * no tests to report: one warning names it.
   */
  onTestFileResult(test: JestTest, result: JestFileResult): void {
    try {
      const path = test.path;
      const file = this.fileOf(path);
      const project = projectOf(test);
      const index = file.runs.findIndex((run) => run.project === project);
      const [run] = index === -1 ? [] : file.runs.splice(index, 1);
      if (file.runs.length === 0) this.files.delete(path);
      if (this.probara?.acceptsResults !== true) return;
      // jest-junit reads the project's name from the file result.
      const displayName = displayNameOf(result.displayName);
      this.reportPending(path, displayName, file.overlapped, file);
      const start =
        typeof result.perfStats?.start === 'number'
          ? result.perfStats.start
          : (run?.start ?? Date.now());
      const deselected = this.deselectedOf(path);
      const skippedElsewhere = deselected === undefined ? this.skippedElsewhereOf(path) : undefined;
      for (const attempt of result.testResults) {
        if (
          deselected !== undefined &&
          this.countAndLeaveOut(deselected, path, attempt, displayName)
        ) {
          continue;
        }
        if (skippedElsewhere !== undefined && isSkippedIn(skippedElsewhere, path, attempt))
          continue;
        const outcome = outcomeOf(path, attempt);
        const reported = file.reported.get(outcome) ?? 0;
        if (reported > 0) {
          file.reported.set(outcome, reported - 1);
          continue;
        }
        const startedAt = typeof attempt.startAt === 'number' ? attempt.startAt : start;
        this.report(path, attempt, startedAt, displayName);
      }
      this.reportFailureOutsideTests(path, result, start, displayName);
      this.checkSetup(path, result);
    } catch (error) {
      this.logError(`Could not report the skipped tests of a file: ${messageOf(error)}`);
    }
  }

  /**
   * Jest awaits it: the results are sent before Jest exits (the attempts of a file Jest never
   * finished too), then the channel is removed.
   */
  async onRunComplete(): Promise<void> {
    try {
      for (const path of new Set(this.pending.map((each) => each.path))) {
        const file = this.files.get(path);
        this.reportPending(path, file?.runs[0]?.displayName, file?.overlapped === true);
      }
      this.logSelection();
      this.logResults();
      // A results file keeps copies of the files attached through the channel, next to it.
      const summary = await this.probara?.complete();
      if (this.watch && summary !== undefined && this.probara !== undefined) {
        await this.followWatchRuns(summary, this.probara);
      }
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    } finally {
      this.files.clear();
      this.closeChannel();
    }
  }

  /**
   * Keeps the runs a re-run of the watch session reported into, and says once where every re-run
   * reports. A run closed (409) or deleted (404) meanwhile refuses the re-run: the session forgets
   * it, and the results it refused go into a new run at once (never lost), unless the results file
   * was written with them (sending them too would record them twice).
   */
  private async followWatchRuns(summary: ReportSummary, sent: ProbaraReporter): Promise<void> {
    const refused: {
      projectId: string;
      displayId: string;
      gone: 'closed' | 'deleted';
      partial: boolean;
    }[] = [];
    for (const project of summary.projects) {
      const known = watchRuns.get(project.projectId);
      if (known !== undefined) {
        // `partial`: the run was closed or deleted after some reports: only the rest was not sent.
        const status = project.status === 'completed' ? undefined : refusalOf(project.errors);
        if (status !== undefined) {
          watchRuns.delete(project.projectId);
          refused.push({
            projectId: project.projectId,
            displayId: known.displayId,
            gone: status,
            partial: project.status === 'partial',
          });
        }
        continue;
      }
      if (project.run === undefined) continue;
      const { ulid, displayId } = project.run;
      watchRuns.set(project.projectId, { ulid, displayId });
      this.logger?.info(
        `Watch mode: every re-run reports into ${displayId} of ${project.projectId}, which stays open: close it in Probara, or with probara run close --project ${project.projectId} --run-ulid ${ulid}`,
      );
    }
    if (refused.length === 0 || this.setup === undefined) return;
    const file = summary.resultsFile;
    // Only a file that was written keeps them; one that could not be leaves them to a new run.
    if (file !== undefined && file.error === undefined) {
      const [configured] = this.setup.projectCodes;
      for (const { projectId, displayId, gone } of refused) {
        // The file names the refused run, which `probara import results` would send them into.
        const flag = projectId === configured ? '--run-ulid ' : `--run-ulids ${projectId}=`;
        this.logger?.info(
          `The run ${displayId} of ${projectId} was ${gone}: the results file ${file.path} keeps this re-run, but names ${displayId}, which refuses it: send it with probara import results ${file.path} ${flag}<ulid of an open run>; the next re-run reports into a new run`,
        );
      }
      return;
    }
    const again = createReporter(watchOptionsOf(this.setup.core));
    for (const { projectId, displayId, gone, partial } of refused) {
      const results = sent.unsentResults(projectId);
      for (const result of results) again.addResult(result);
      const count = results.length === 1 ? 'the 1 result' : `the ${String(results.length)} results`;
      // `partial`: the run recorded the first results of this re-run, and keeps them.
      this.logger?.info(
        partial
          ? `The run ${displayId} of ${projectId} was ${gone}: sent ${count} it refused into a new run; the rest of this re-run is in ${displayId}`
          : `The run ${displayId} of ${projectId} was ${gone}: sent ${count} of this re-run into a new run`,
      );
    }
    // Its new runs are the session's from now on; a refusal again is logged by core, not retried.
    const resent = await again.complete();
    for (const project of resent.projects) {
      if (project.run === undefined || watchRuns.has(project.projectId)) continue;
      const { ulid, displayId } = project.run;
      watchRuns.set(project.projectId, { ulid, displayId });
      this.logger?.info(
        `Watch mode: every re-run reports into ${displayId} of ${project.projectId}, which stays open: close it in Probara, or with probara run close --project ${project.projectId} --run-ulid ${ulid}`,
      );
    }
  }

  /**
   * The failure of a file outside its tests: with results, the failed test jest-junit writes for
   * it (the same key `probara import junit` gives it); without, one warning, as jest-junit writes
   * nothing by default for a file that could not run.
   */
  private reportFailureOutsideTests(
    path: string,
    result: JestFileResult,
    start: number,
    displayName: string | undefined,
  ): void {
    const failure = result.testExecError;
    if (failure === undefined || failure === null) return;
    const message = typeof failure.message === 'string' ? failure.message : '';
    const stack = typeof failure.stack === 'string' ? failure.stack : '';
    if (result.testResults.length === 0) {
      const reason = firstLine(message) || firstLine(stack);
      this.logger?.warn(
        `Could not report ${this.relativeFile(path)}: Jest could not run it${reason === '' ? '' : ` (${reason})`}`,
      );
      return;
    }
    const error = stack.includes(message) ? stack : [message, stack].join('\n');
    this.report(
      path,
      {
        ancestorTitles: [''],
        title: OUTSIDE_TESTS_FAILURE,
        status: 'failed',
        duration: 0,
        failureMessages: [error.trim() === '' ? 'Jest failed the file outside its tests' : error],
      },
      start,
      displayName,
    );
  }

  /**
   * One warning when an option the setup file carries out is on, but a test file with tests ran
   * without it: those tests get nothing of it.
   */
  private checkSetup(path: string, result: JestFileResult): void {
    if (this.channel === undefined) return;
    if (result.testResults.length === 0) return;
    if (this.channel.hasSetup(path)) {
      const failure =
        this.selection === undefined ? undefined : this.channel.selectionFailure(path);
      if (failure !== undefined) {
        this.session.warnOnce(selectionNotApplied(failure), this.relativeFile(path));
      }
      return;
    }
    const file = this.relativeFile(path);
    if (this.setup?.captureOutput === true) this.session.warnOnce(SETUP_MISSING, file);
    if (this.selection !== undefined) this.session.warnOnce(SELECTION_SETUP_MISSING, file);
  }

  /**
   * The tests of `path` the setup file skipped (`runCasesOnly`), when it selected its tests; none
   * without the setup file, or when it could not skip any: every test then ran.
   */
  private deselectedOf(path: string): Set<string> | undefined {
    const channel = this.channel;
    if (this.selection === undefined || channel?.hasSetup(path) !== true) return undefined;
    if (channel.selectionFailure(path) !== undefined) return undefined;
    return channel.deselected(path);
  }

  /**
   * In a file the setup file could not skip tests in (every test of it ran), the tests it skipped
   * all the same in another Jest project that runs the file: the lines of the channel name the file,
   * not the project. They stay out of the report (they match no case of the run), and of the counts.
   */
  private skippedElsewhereOf(path: string): Set<string> | undefined {
    const channel = this.channel;
    if (this.selection === undefined || channel?.hasSetup(path) !== true) return undefined;
    if (channel.selectionFailure(path) === undefined) return undefined;
    const skipped = channel.deselected(path);
    return skipped.size === 0 ? undefined : skipped;
  }

  /**
   * Whether a test of a file the selection ran in is left out of the report: the setup file
   * skipped it, or it never ran and matches no case of the run (the setup file's hook does not run
   * in a file whose tests were all skipped already). A test that ran is reported, unless its names
   * hold `{displayName}`: the setup file, which cannot know the project's name, kept it, and it is
   * decided here with the name.
   */
  private leavesOut(
    deselected: Set<string>,
    path: string,
    attempt: JestAttempt,
    displayName: string | undefined,
  ): boolean {
    const selection = this.selection;
    if (selection === undefined) return false;
    if (namesProject(attempt)) return !selection.selects(path, attempt, displayName);
    if (ran(attempt)) return false;
    return (
      deselected.has(testIdOf(path, attempt)) || !selection.selects(path, attempt, displayName)
    );
  }

  /** Counts a test of a file the selection ran in; whether it is left out of the report. */
  private countAndLeaveOut(
    deselected: Set<string>,
    path: string,
    attempt: JestAttempt,
    displayName: string | undefined,
  ): boolean {
    const selection = this.selection;
    if (selection === undefined) return false;
    selection.tests += 1;
    const left = this.leavesOut(deselected, path, attempt, displayName);
    if (left && ran(attempt)) selection.ran += 1;
    else if (left) selection.skipped += 1;
    return left;
  }

  /** How many tests of the run's cases ran (`runCasesOnly`), or a warning when none did. */
  private logSelection(): void {
    const selection = this.selection;
    if (selection === undefined || selection.tests === 0) return;
    const { run, tests, skipped, ran: ranLeft } = selection;
    const why = "(the project's name in {displayName} matches no case)";
    if (tests === skipped + ranLeft) {
      this.logger?.warn(
        ranLeft === 0
          ? `No test matches the cases of the run ${run}: every test was skipped, and none is reported`
          : `No test matches the cases of the run ${run}: none is reported; ${String(skipped)} skipped, ${String(ranLeft)} ran ${why}`,
      );
      return;
    }
    const ranClause = ranLeft === 0 ? '' : `; ${String(ranLeft)} ran and not reported ${why}`;
    this.logger?.info(
      `Ran only the tests of run ${run}: ${String(tests - skipped - ranLeft)} of ${String(tests)} tests match its cases; ${String(skipped)} skipped and not reported${ranClause}`,
    );
  }

  /** Never an error: reporting problems never fail the Jest run. */
  getLastError(): Error | undefined {
    return undefined;
  }

  private fileOf(path: string): FileState {
    let file = this.files.get(path);
    if (file === undefined) {
      file = { runs: [], overlapped: false, starts: new Map(), reported: new Map() };
      this.files.set(path, file);
    }
    return file;
  }

  /**
   * Creates the channel of the `probara.*` helpers and names it to the test processes, which Jest
   * starts after `onRunStart`, with the settings of the setup file (`selection`: the cases of the
   * run of `runCasesOnly`). When nothing is reported, the helpers get no channel (not even one of
   * an outer run): they do nothing, and every test runs.
   */
  private openChannel(selection: RunSelection | undefined): void {
    this.outerChannel = { value: process.env[CHANNEL_VARIABLE] };
    Reflect.deleteProperty(process.env, CHANNEL_VARIABLE);
    if (this.probara?.acceptsResults !== true) return;
    try {
      this.channel = createChannel(
        (warning) => {
          this.warnFromTest(warning);
        },
        (message) => this.logger?.debug(message),
      );
      writeSettings(this.channel.dir, {
        captureOutput: this.setup?.captureOutput === true,
        ...(selection === undefined ? {} : { selection }),
      });
      if (selection !== undefined) {
        this.selection = {
          run: selection.run,
          selects: createSelector(selection),
          tests: 0,
          skipped: 0,
          ran: 0,
        };
      }
      process.env[CHANNEL_VARIABLE] = this.channel.dir;
      process.once('exit', this.closeOnExit);
    } catch (error) {
      this.logError(
        `The probara.* helpers are off: could not create their channel: ${messageOf(error)}`,
      );
    }
  }

  /** Removes the channel and gives the variable back its value; never throws. */
  private closeChannel(): void {
    try {
      process.removeListener('exit', this.closeOnExit);
      this.channel?.close();
      this.channel = undefined;
      const outer = this.outerChannel;
      this.outerChannel = undefined;
      if (outer === undefined) return;
      if (outer.value === undefined) Reflect.deleteProperty(process.env, CHANNEL_VARIABLE);
      else process.env[CHANNEL_VARIABLE] = outer.value;
    } catch {
      // A leftover temporary directory is never worth an error.
    }
  }

  /** A warning of a test process, once per message, naming the test (or file) it came from. */
  private warnFromTest(warning: ChannelWarning): void {
    const file = warning.file === undefined ? undefined : this.relativeFile(warning.file);
    const where =
      file === undefined
        ? 'a test'
        : warning.test === undefined
          ? file
          : `${file} › ${warning.test}`;
    this.session.warnOnce(warning.message, where);
  }

  /**
   * Sends the attempts of `path` Jest reported so far, each with what its helpers said. An attempt
   * whose key several attempts claim, or of a file several projects ran at once, gets none of it,
   * with one warning: helper lines name no test beyond their key, and the details of one test must
   * never land on another.
   *
   * Of a file several projects ran at once, an attempt whose title holds `{displayName}` names no
   * project (Jest's case events carry the first project's context): it is left to the file result
   * of each project (`fileState`), which sends its last attempt with that project's name.
   */
  private reportPending(
    path: string,
    displayName: string | undefined,
    overlapped: boolean,
    fileState?: FileState,
  ): void {
    const details = this.channel?.take(path) ?? new Map<string, AttemptDetails>();
    const [mine, others] = [
      this.pending.filter((each) => each.path === path),
      this.pending.filter((each) => each.path !== path),
    ];
    this.pending = others;
    const claims = new Map<string, number>();
    for (const { attempt } of mine) {
      const key = channelKeyOf(path, attempt);
      claims.set(key, (claims.get(key) ?? 0) + 1);
    }
    const file = this.relativeFile(path);
    // A todo reaches onTestCaseResult: one the selection left out is not reported either.
    const deselected = this.deselectedOf(path);
    const skippedElsewhere = deselected === undefined ? this.skippedElsewhereOf(path) : undefined;
    for (const { attempt, startedAt } of mine) {
      if (overlapped && fileState !== undefined && namesProject(attempt)) {
        this.session.warnOnce(
          'Several Jest projects ran this file at once: a test whose title holds {displayName} is sent once per project, its last attempt only',
          file,
        );
        const outcome = outcomeOf(path, attempt);
        const reported = fileState.reported.get(outcome) ?? 0;
        if (reported > 0) fileState.reported.set(outcome, reported - 1);
        continue;
      }
      if (deselected !== undefined && this.leavesOut(deselected, path, attempt, displayName))
        continue;
      if (skippedElsewhere !== undefined && isSkippedIn(skippedElsewhere, path, attempt)) continue;
      try {
        const key = channelKeyOf(path, attempt);
        let found = details.get(key);
        if (found !== undefined && overlapped) {
          this.session.warnOnce(
            'Several Jest projects ran this file at once: what the probara.* helpers said about its tests is left out',
            file,
          );
          found = undefined;
        } else if (found !== undefined && (claims.get(key) ?? 0) > 1) {
          this.session.warnOnce(
            'Several tests of one file have the same full name and attempt: what the probara.* helpers said about them is left out',
            `${file} › ${[...attempt.ancestorTitles, attempt.title].join(' ')}`,
          );
          found = undefined;
        }
        this.report(path, attempt, startedAt, displayName, found);
      } catch (error) {
        // A reporter must never break the test run: this attempt is lost, and the log says why.
        this.logError(`Could not report an attempt of ${titleOf(attempt)}: ${messageOf(error)}`);
      }
    }
    const unclaimed = [...details.keys()].filter((key) => !claims.has(key));
    if (unclaimed.length > 0) {
      const count = unclaimed.length;
      this.logger?.debug(
        `Left out what the probara.* helpers said about ${String(count)} attempt${count === 1 ? '' : 's'} Jest did not report in ${file}: ${unclaimed.map(attemptLabelOf).join(', ')}`,
      );
    }
  }

  private report(
    path: string,
    attempt: JestAttempt,
    startedAt: number,
    displayName: string | undefined,
    details?: AttemptDetails,
  ): void {
    // Sent, or written to the results file while reporting is off.
    if (this.probara?.acceptsResults !== true) return;
    for (const problem of details?.problems ?? []) this.session.warnOnce(problem, titleOf(attempt));
    if (details?.metadata.ignored === true) {
      this.session.countIgnored();
      return;
    }
    const context: TranslationContext = {
      ...this.context,
      displayName,
      warn: (message) => {
        this.session.warnOnce(message, titleOf(attempt));
      },
    };
    const input = toResultInput(path, attempt, context, startedAt, details);
    // Counted as core sends it: mapped by statusMapping, then left out by statusFilter.
    this.session.count(input, testIdOf(path, attempt));
    this.probara.addResult(input);
  }

  private relativeFile(path: string): string {
    return relativeFile(path, this.context.rootDir);
  }

  /** One error line on stderr, without the token, even before the logger is known. */
  private logError(message: string): void {
    logAdapterError(message, this.options, this.logger);
  }

  /**
   * `Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped, 0 blocked)`, with the statuses
   * core sends (after `statusMapping`), before core logs the run.
   */
  private logResults(): void {
    // Core logs the results file it writes instead.
    if (this.probara?.enabled !== true) return;
    const line = this.session.summaryLine();
    if (line !== undefined) this.logger?.info(line);
  }
}
