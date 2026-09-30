/** The Jest reporter: translates Jest's events into `@probara/core` results. */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createAdapterSession,
  createReporter,
  logAdapterError,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
} from '@probara/core';
import { attemptKey, CHANNEL_VARIABLE, writeSettings } from './channel.js';
import {
  createChannel,
  type AttemptDetails,
  type Channel,
  type ChannelWarning,
} from './channel-reader.js';
import type { JestAttempt, JestCaseStart, JestFileResult, JestTest } from './jest.js';
import { resolveSetup, type ProbaraJestOptions, type Setup } from './options.js';
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
  /** What the channel variable held before the run, restored after it. */
  private outerChannel: { value: string | undefined } | undefined;
  private readonly closeOnExit = (): void => {
    this.closeChannel();
  };

  /** Jest calls it with its global config and the reporter options (and a context it needs not). */
  constructor(_globalConfig?: unknown, options: ProbaraJestOptions = {}) {
    this.options = options;
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

  onRunStart(): void {
    try {
      const options: unknown = this.options;
      if (typeof options !== 'object' || options === null) {
        // Core turns reporting off with a problem for options that are not an object.
        this.probara = createReporter(options as ReporterOptions);
        return;
      }
      if (this.setup !== undefined) this.probara = createReporter(this.setup.core);
    } catch (error) {
      this.probara = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
    this.openChannel();
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
      this.reportPending(path, displayName, file.overlapped);
      const start =
        typeof result.perfStats?.start === 'number'
          ? result.perfStats.start
          : (run?.start ?? Date.now());
      for (const attempt of result.testResults) {
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
      this.logResults();
      // A results file keeps copies of the files attached through the channel, next to it.
      await this.probara?.complete();
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    } finally {
      this.closeChannel();
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
    if (this.setup?.captureOutput !== true || this.channel === undefined) return;
    if (result.testResults.length === 0 || this.channel.hasSetup(path)) return;
    this.session.warnOnce(SETUP_MISSING, this.relativeFile(path));
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
   * starts after `onRunStart`. When nothing is reported, the helpers get no channel (not even one
   * of an outer run): they do nothing.
   */
  private openChannel(): void {
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
      writeSettings(this.channel.dir, { captureOutput: this.setup?.captureOutput === true });
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
   */
  private reportPending(path: string, displayName: string | undefined, overlapped: boolean): void {
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
    for (const { attempt, startedAt } of mine) {
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
    const context = { ...this.context, displayName };
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
