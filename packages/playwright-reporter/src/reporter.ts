/** The Playwright reporter: translates Playwright's events into `@probara/core` results. */
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  createAdapterSession,
  createReporter,
  logAdapterError,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
} from '@probara/core';
import { resolveSetup, type ProbaraPlaywrightOptions } from './options.js';
import { toAttempt, type TranslationContext } from './translate.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The title of `test` for a log line, or a placeholder when even that fails. */
function titleOf(test: TestCase): string {
  try {
    return `"${test.title}"`;
  } catch {
    return 'a test';
  }
}

/**
 * Sends every test result of a Playwright run to Probara. Register it in `playwright.config`:
 * `reporter: [['list'], ['@probara/playwright-reporter']]`. It never throws into Playwright and
 * never changes Playwright's exit code: reporting failures are logged on stderr.
 */
export default class ProbaraPlaywrightReporter implements Reporter {
  private readonly options: ProbaraPlaywrightOptions;
  private probara: ProbaraReporter | undefined;
  private context: TranslationContext = { projectCodes: [], captureOutput: false };
  private logger: Logger | undefined;
  /** What was handed to core, for the `Sending N results` line, and the warnings given once. */
  private session: AdapterSession = createAdapterSession();

  constructor(options: ProbaraPlaywrightOptions = {}) {
    this.options = options;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    try {
      const options: unknown = this.options;
      if (typeof options !== 'object' || options === null) {
        // Core turns reporting off with a problem for options that are not an object.
        this.probara = createReporter(options as ReporterOptions);
        return;
      }
      const setup = resolveSetup(this.options, config.rootDir);
      this.context = { projectCodes: setup.projectCodes, captureOutput: setup.captureOutput };
      this.logger = setup.core.logger;
      this.session = createAdapterSession({
        logger: setup.core.logger,
        statusRules: setup.statusRules,
        projectCodes: setup.projectCodes,
      });
      this.probara = createReporter(setup.core);
    } catch (error) {
      // A reporter must never break the test run: nothing is reported, and the log says why.
      this.probara = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
  }

  /** Called once per attempt: every retry is a result of its own, in attempt order. */
  onTestEnd(test: TestCase, result: TestResult): void {
    try {
      // Sent, or written to the results file while reporting is off.
      if (this.probara?.acceptsResults !== true) return;
      const attempt = toAttempt(test, result, this.context);
      for (const problem of attempt.problems) this.session.warnOnce(problem, titleOf(test));
      if (attempt.ignored) {
        this.session.countIgnored();
        return;
      }
      // Counted as core sends it: mapped by statusMapping, then left out by statusFilter.
      this.session.count(attempt.input, test);
      this.probara.addResult(attempt.input);
    } catch (error) {
      // A reporter must never break the test run: this attempt is lost, and the log says why.
      this.logError(`Could not report an attempt of ${titleOf(test)}: ${messageOf(error)}`);
    }
  }

  async onEnd(): Promise<void> {
    try {
      this.logResults();
      await this.probara?.complete();
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    }
  }

  /** One error line on stderr, without the token, even before the logger is known. */
  private logError(message: string): void {
    logAdapterError(message, this.options, this.logger);
  }

  /**
   * `Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped, 0 blocked)`, with the statuses
   * core sends (after `statusMapping`), and the attempts `statusFilter` leaves out, before core
   * logs the run.
   */
  private logResults(): void {
    // Core logs the results file it writes instead.
    if (this.probara?.enabled !== true) return;
    const line = this.session.summaryLine();
    if (line !== undefined) this.logger?.info(line);
  }
}
