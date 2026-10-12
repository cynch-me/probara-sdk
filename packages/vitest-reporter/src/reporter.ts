/**
 * The Vitest reporter: builds the results of a run from the reported tasks, once the run ended,
 * and sends them with `@probara/core`. It never throws into Vitest: every hook is guarded, and a
 * failure is logged on stderr, so the exit code of the user's run never changes because of it.
 */
import type { Reporter, TestModule, Vitest } from 'vitest/node';
import {
  createAdapterSession,
  createReporter,
  logAdapterError,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
} from '@probara/core';
import { probaraLogger, type LogSink } from './logger.js';
import { resolveSetup, type ProbaraVitestOptions, type Setup } from './options.js';
import { factsOf, type ModuleFacts } from './tree.js';
import {
  failureToResultInput,
  toResultInput,
  type ReportedFailure,
  type ReportedTest,
  type TranslationContext,
} from './translate.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The identity of a test within the run, for the `Sending N results of M tests` count. */
function testOf(test: ReportedTest): string {
  return JSON.stringify([test.file, ...test.ancestors, test.title]);
}

/** The warning of files Vitest never ran: they have no test to report. */
function neverRanWarning(count: number): string {
  return `Vitest did not run ${count} test ${count === 1 ? 'file' : 'files'} of this run: nothing of ${count === 1 ? 'it is' : 'them are'} reported`;
}

/** The warning of errors Vitest reports outside any test (unhandled errors): they are not results. */
function unhandledWarning(count: number): string {
  return `Vitest reported ${count} unhandled error${count === 1 ? '' : 's'} outside the tests: ${count === 1 ? 'it is' : 'they are'} not results, and nothing is sent for ${count === 1 ? 'it' : 'them'}`;
}

/**
 * Sends every test result of a Vitest run. Register it in the Vitest config:
 * `reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]]`. It never throws
 * into Vitest and never changes Vitest's exit code: reporting failures are logged on stderr.
 */
export default class ProbaraVitestReporter implements Reporter {
  private readonly options: ProbaraVitestOptions;
  /** Vitest's logger, once Vitest calls `onInit`: every line of the reporter goes through it. */
  private sink: LogSink | undefined;
  private setup: Setup | undefined;
  private probara: ProbaraReporter | undefined;
  private logger: Logger | undefined;
  /** What was handed to core, for the `Sending N results` line, and the warnings given once. */
  private session: AdapterSession = createAdapterSession();

  /** Vitest calls it with the options of the config entry, as they are. */
  constructor(options: ProbaraVitestOptions = {}) {
    this.options = options;
  }

  /** Vitest calls it once, with its context: the root the files are relative to, and its logger. */
  onInit(vitest: Vitest): void {
    this.sink = vitest.logger;
    try {
      const given: unknown = this.options;
      if (typeof given !== 'object' || given === null) {
        // Core would log the same problem on its own console: this one goes through Vitest's logger.
        this.logError('Probara reporting is off: options must be an object');
        return;
      }
      const setup = resolveSetup(this.options, {
        rootDir: vitest.config.root,
        sink: vitest.logger,
      });
      this.setup = setup;
      this.logger = setup.core.logger;
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

  /** Vitest calls it before the first file of a run runs: the run of this reporter starts here. */
  onTestRunStart(): void {
    try {
      if (this.setup !== undefined) this.probara = createReporter(this.setup.core);
    } catch (error) {
      this.probara = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
  }

  /**
   * Called once the run ended, with its test files: the results are built here, from the whole
   * task tree (a run of shards or merged reports included), and sent before Vitest exits. Never
   * rejects.
   */
  async onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<unknown>,
  ): Promise<void> {
    try {
      if (this.probara?.acceptsResults === true) {
        this.reportRun(modules, unhandledErrors);
      }
      this.logResults();
      await this.probara?.complete();
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    }
  }

  /** Builds the results of every file of the run and hands them to core, in file order. */
  private reportRun(
    modules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<unknown>,
  ): void {
    const setup = this.setup;
    if (setup === undefined) return;
    const context: TranslationContext = {
      projectCodes: setup.projectCodes,
      keyIncludesFile: setup.keyIncludesFile,
      rootDir: setup.core.rootDir ?? '',
      issueUrlTemplate: setup.issueUrlTemplate,
      warn: (message) => {
        this.session.warnOnce(message, 'the run');
      },
    };
    const root = context.rootDir;
    let neverRan = 0;
    for (const module of modules) {
      let facts: ModuleFacts;
      try {
        facts = factsOf(module, root);
      } catch (error) {
        // The file's tree did not read: its results are lost, the others are not.
        this.logError(`Could not report ${module.moduleId}: ${messageOf(error)}`);
        continue;
      }
      if (facts.neverRan) neverRan += 1;
      for (const failure of facts.failures) this.reportFailure(failure, context);
      for (const test of facts.tests) this.reportTest(test, context);
    }
    if (neverRan > 0) this.session.warnOnce(neverRanWarning(neverRan), 'the run');
    if (unhandledErrors.length > 0) {
      this.session.warnOnce(unhandledWarning(unhandledErrors.length), 'the run');
    }
  }

  private reportTest(test: ReportedTest, context: TranslationContext): void {
    try {
      const input = toResultInput(test, context);
      // Counted as core sends it: mapped by statusMapping, then left out by statusFilter.
      this.session.count(input, testOf(test));
      this.probara?.addResult(input);
    } catch (error) {
      // This test is lost; the others of the run are not.
      this.logError(`Could not report "${test.title}": ${messageOf(error)}`);
    }
  }

  private reportFailure(failure: ReportedFailure, context: TranslationContext): void {
    try {
      const input = failureToResultInput(failure, context);
      this.session.count(input, JSON.stringify([failure.file, failure.name]));
      this.probara?.addResult(input);
    } catch (error) {
      this.logError(`Could not report the failure of ${failure.name}: ${messageOf(error)}`);
    }
  }

  /**
   * One error line, without the token, even before the setup is known: through the logger of the
   * setup, else Vitest's logger (stderr), else core's console.
   */
  private logError(message: string): void {
    const logger =
      this.logger ?? (this.sink === undefined ? undefined : probaraLogger(this.sink, false));
    logAdapterError(message, this.options, logger);
  }

  /** `Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped, 0 blocked)`, before core logs the run. */
  private logResults(): void {
    // Core logs the results file it writes instead.
    if (this.probara?.enabled !== true) return;
    const line = this.session.summaryLine();
    if (line !== undefined) this.logger?.info(line);
  }
}
