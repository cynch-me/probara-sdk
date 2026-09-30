/** The Jest reporter: translates Jest's events into `@probara/core` results. */
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  createAdapterSession,
  createReporter,
  logAdapterError,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
} from '@probara/core';
import { attemptKey, CHANNEL_VARIABLE } from './channel.js';
import {
  createChannel,
  type AttemptDetails,
  type Channel,
  type ChannelWarning,
} from './channel-reader.js';
import type { JestAttempt, JestCaseStart, JestFileResult, JestTest } from './jest.js';
import { resolveSetup, type ProbaraJestOptions, type Setup } from './options.js';
import { testIdOf, toResultInput, type TranslationContext } from './translate.js';

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

/** An attempt Jest reported, waiting for the end of its file to be sent with its details. */
interface PendingAttempt {
  path: string;
  attempt: JestAttempt;
  startedAt: number;
}

/** The key of the channel lines of an attempt: its file, Jest's full name, its attempt number. */
function channelKeyOf(path: string, attempt: JestAttempt): string {
  const invocations = attempt.invocations ?? 1;
  return attemptKey(
    path,
    [...attempt.ancestorTitles, attempt.title].join(' '),
    invocations > 1 ? invocations : 1,
  );
}

/** What the reporter keeps of one test file while Jest runs it. */
interface FileState {
  /** When Jest began the file: the start of a result Jest gives no start for. */
  start: number;
  /** When each attempt of each test started, oldest first (`onTestCaseStart`). */
  starts: Map<string, number[]>;
  /** How many tests of each identity `onTestCaseResult` reported (their first attempts). */
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
    this.closeChannel(false);
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
      this.fileOf(test.path);
    } catch (error) {
      this.logError(`Could not follow a test file: ${messageOf(error)}`);
    }
  }

  /** Called before each attempt of a test that runs (never for a skipped one, nor a todo). */
  onTestCaseStart(test: JestTest, start: JestCaseStart): void {
    try {
      const starts = this.fileOf(test.path).starts;
      const id = testIdOf(test.path, { ...start, status: 'passed' });
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
      if ((attempt.invocations ?? 1) <= 1) file.reported.set(id, (file.reported.get(id) ?? 0) + 1);
      const startedAt = typeof attempt.startedAt === 'number' ? attempt.startedAt : started;
      if (this.probara?.acceptsResults !== true) return;
      this.pending.push({ path: test.path, attempt, startedAt: startedAt ?? file.start });
    } catch (error) {
      // A reporter must never break the test run: this attempt is lost, and the log says why.
      this.logError(`Could not report an attempt of ${titleOf(attempt)}: ${messageOf(error)}`);
    }
  }

  /**
   * Called once a file ends, with the last attempt of each of its tests: its attempts are sent with
   * what the helpers said, then those `onTestCaseResult` never saw (skipped tests). A file Jest
   * could not run has no tests to report: one warning names it.
   */
  onTestFileResult(test: JestTest, result: JestFileResult): void {
    try {
      const file = this.fileOf(test.path);
      this.files.delete(test.path);
      if (this.probara?.acceptsResults !== true) return;
      this.reportPending(test.path);
      const failure = result.testExecError;
      if (failure !== undefined && failure !== null) {
        const reason = firstLine(failure.message ?? '');
        this.logger?.warn(
          `Could not report ${this.relativeFile(test.path)}: Jest could not run it${reason === '' ? '' : ` (${reason})`}`,
        );
      }
      const start =
        typeof result.perfStats?.start === 'number' ? result.perfStats.start : file.start;
      for (const attempt of result.testResults) {
        const id = testIdOf(test.path, attempt);
        const reported = file.reported.get(id) ?? 0;
        if (reported > 0) {
          file.reported.set(id, reported - 1);
          continue;
        }
        this.report(
          test.path,
          attempt,
          typeof attempt.startAt === 'number' ? attempt.startAt : start,
        );
      }
    } catch (error) {
      this.logError(`Could not report the skipped tests of a file: ${messageOf(error)}`);
    }
  }

  /**
   * Jest awaits it: the results are sent before Jest exits (the attempts of a file Jest never
   * finished too), then the channel is removed.
   */
  async onRunComplete(): Promise<void> {
    let keepFiles = false;
    try {
      for (const path of new Set(this.pending.map((each) => each.path))) this.reportPending(path);
      this.logResults();
      const summary = await this.probara?.complete();
      // The results file points at the files attached through the channel.
      const written = summary?.resultsFile;
      keepFiles = written !== undefined && written.results > 0 && written.error === undefined;
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    } finally {
      this.closeChannel(keepFiles);
    }
  }

  /** Never an error: reporting problems never fail the Jest run. */
  getLastError(): Error | undefined {
    return undefined;
  }

  private fileOf(path: string): FileState {
    let file = this.files.get(path);
    if (file === undefined) {
      file = { start: Date.now(), starts: new Map(), reported: new Map() };
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
      this.channel = createChannel((warning) => {
        this.warnFromTest(warning);
      });
      process.env[CHANNEL_VARIABLE] = this.channel.dir;
      process.once('exit', this.closeOnExit);
    } catch (error) {
      this.logError(
        `The probara.* helpers are off: could not create their channel: ${messageOf(error)}`,
      );
    }
  }

  /** Removes the channel and gives the variable back its value; never throws. */
  private closeChannel(keepFiles: boolean): void {
    try {
      process.removeListener('exit', this.closeOnExit);
      this.channel?.close({ keepFiles });
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

  /** Sends the attempts of `path` Jest reported so far, each with its details. */
  private reportPending(path: string): void {
    const details = this.channel?.take(path) ?? new Map<string, AttemptDetails>();
    const [mine, others] = [
      this.pending.filter((each) => each.path === path),
      this.pending.filter((each) => each.path !== path),
    ];
    this.pending = others;
    for (const { attempt, startedAt } of mine) {
      try {
        this.report(path, attempt, startedAt, details.get(channelKeyOf(path, attempt)));
      } catch (error) {
        // A reporter must never break the test run: this attempt is lost, and the log says why.
        this.logError(`Could not report an attempt of ${titleOf(attempt)}: ${messageOf(error)}`);
      }
    }
  }

  private report(
    path: string,
    attempt: JestAttempt,
    startedAt: number,
    details?: AttemptDetails,
  ): void {
    // Sent, or written to the results file while reporting is off.
    if (this.probara?.acceptsResults !== true) return;
    for (const problem of details?.problems ?? []) this.session.warnOnce(problem, titleOf(attempt));
    if (details?.metadata.ignored === true) {
      this.session.countIgnored();
      return;
    }
    const input = toResultInput(path, attempt, this.context, startedAt, details);
    // Counted as core sends it: mapped by statusMapping, then left out by statusFilter.
    this.session.count(input, testIdOf(path, attempt));
    this.probara.addResult(input);
  }

  private relativeFile(path: string): string {
    return relative(this.context.rootDir, path).split(sep).join('/');
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
