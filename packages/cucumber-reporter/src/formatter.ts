/**
 * The Cucumber formatter: every attempt of every scenario is sent to Probara as it finishes, through
 * `@probara/core`. cucumber-js loads it by name (`--format @probara/cucumber-reporter`). It writes
 * nothing to stdout, never throws into cucumber-js and never changes its exit code: reporting failures
 * are logged on stderr.
 */
import { Formatter, type IFormatterOptions } from '@cucumber/cucumber';
import {
  createAdapterSession,
  createReporter,
  logAdapterError,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
} from '@probara/core';
import { resolveSetup } from './options.js';
import { toAttempt } from './translate.js';

/** The two messages the formatter reads: a test case starting, and a test case attempt finishing. */
interface EnvelopeLike {
  readonly testCaseStarted?: {
    readonly id: string;
    readonly timestamp: { readonly seconds: number; readonly nanos: number };
  };
  readonly testCaseFinished?: { readonly testCaseStartedId: string };
}

const NANOSECONDS_PER_MS = 1_000_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends every result of a Cucumber run to Probara. Its options are read from the `probara` key of the
 * format options: `formatOptions: { probara: { ... } }` in the Cucumber configuration.
 */
export default class ProbaraCucumberFormatter extends Formatter {
  /** The formatter's options as the configuration gave them, for logging without the token. */
  private readonly given: unknown;
  /** The directory the feature paths are relative to: the `rootDir` option, else where Cucumber runs. */
  private rootDir: string;
  private probara: ProbaraReporter | undefined;
  private logger: Logger | undefined;
  /** What was handed to core, for the `Sending N results` line, and the warnings given once. */
  private session: AdapterSession = createAdapterSession();
  /** The start time of each test case attempt still running, by its `testCaseStarted` id. */
  private readonly startedAt = new Map<string, Date>();

  constructor(options: IFormatterOptions) {
    super(options);
    const raw: unknown = options.parsedArgvOptions.probara;
    this.given = raw;
    this.rootDir = options.cwd;
    this.start(raw);
    options.eventBroadcaster.on('envelope', (envelope: EnvelopeLike) => {
      this.onEnvelope(envelope);
    });
  }

  override async finished(): Promise<void> {
    try {
      this.logResults();
      await this.probara?.complete();
    } catch (error) {
      // `complete()` never rejects; this only guards the formatter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    }
    try {
      // Closes the file of a formatter with a path; nothing to close on stdout.
      await super.finished();
    } catch (error) {
      this.logError(`Could not close the formatter output: ${messageOf(error)}`);
    }
  }

  /** Sets up core for the run, or turns reporting off with a message when that fails. */
  private start(raw: unknown): void {
    try {
      const own: unknown = raw ?? {};
      if (typeof own !== 'object' || own === null) {
        // Core turns reporting off with a problem for options that are not an object.
        this.probara = createReporter(own as ReporterOptions);
        return;
      }
      const setup = resolveSetup(own, this.rootDir);
      this.rootDir = setup.core.rootDir ?? this.rootDir;
      this.logger = setup.core.logger;
      this.session = createAdapterSession({
        logger: setup.core.logger,
        statusRules: setup.statusRules,
        projectCodes: setup.projectCodes,
      });
      this.probara = createReporter(setup.core);
    } catch (error) {
      // A formatter must never break the test run: nothing is reported, and the log says why.
      this.probara = undefined;
      this.logError(`Probara reporting is off: the formatter could not start: ${messageOf(error)}`);
    }
  }

  private onEnvelope(envelope: EnvelopeLike): void {
    try {
      const started = envelope.testCaseStarted;
      if (started !== undefined) {
        const { seconds, nanos } = started.timestamp;
        this.startedAt.set(started.id, new Date(seconds * 1000 + nanos / NANOSECONDS_PER_MS));
      }
      const finished = envelope.testCaseFinished;
      if (finished !== undefined) this.onAttemptFinished(finished.testCaseStartedId);
    } catch (error) {
      // A formatter must never break the test run: this attempt is lost, and the log says why.
      this.logError(`Could not report an attempt: ${messageOf(error)}`);
    }
  }

  /** Called once per attempt: every retry is a result of its own, in attempt order. */
  private onAttemptFinished(testCaseStartedId: string): void {
    const startedAt = this.startedAt.get(testCaseStartedId);
    this.startedAt.delete(testCaseStartedId);
    // Sent, or written to the results file while reporting is off.
    if (this.probara?.acceptsResults !== true) return;
    const attempt = this.eventDataCollector.getTestCaseAttempt(testCaseStartedId);
    const { input, problems } = toAttempt(attempt, {
      cwd: this.cwd,
      rootDir: this.rootDir,
      startedAt,
    });
    for (const problem of problems) this.session.warnOnce(problem, attempt.pickle.name);
    if (input === undefined) return;
    // Counted as core sends it: mapped by statusMapping, then left out by statusFilter.
    this.session.count(input, attempt.pickle.id);
    this.probara.addResult(input);
  }

  /** One error line on stderr, without the token, even before the logger is known. */
  private logError(message: string): void {
    logAdapterError(message, this.given, this.logger);
  }

  /**
   * `Sending 4 results of 4 tests (4 passed, 0 failed, 0 skipped, 0 blocked)`, with the statuses core
   * sends, and the attempts left out, before core logs the run.
   */
  private logResults(): void {
    // Core logs the results file it writes instead.
    if (this.probara?.enabled !== true) return;
    const line = this.session.summaryLine();
    if (line !== undefined) this.logger?.info(line);
  }
}
