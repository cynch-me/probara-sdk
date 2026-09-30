/** The Playwright reporter: translates Playwright's events into `@probara/core` results. */
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  applyStatusRules,
  createConsoleLogger,
  createReporter,
  redact,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
  type ResultStatus,
  type StatusRules,
} from '@probara/core';
import { resolveSetup, type ProbaraPlaywrightOptions } from './options.js';
import { toAttempt, type TranslationContext } from './translate.js';

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`;
}

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
  private statusRules: StatusRules = { statusMapping: {}, statusFilter: [] };
  private readonly tests = new Set<TestCase>();
  /** Attempts `statusFilter` leaves out. */
  private filtered = 0;
  /** Attempts that called `probara.ignore()`. */
  private ignored = 0;
  private readonly warned = new Set<string>();
  private readonly counts: Record<ResultStatus, number> = {
    passed: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
  };

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
      if (setup.statusRules !== undefined) this.statusRules = setup.statusRules;
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
      for (const problem of attempt.problems) this.warnOnce(problem, titleOf(test));
      if (attempt.ignored) {
        this.ignored += 1;
        return;
      }
      const { input } = attempt;
      // Counted as core sends it: mapped by statusMapping, then left out by statusFilter.
      const { status, filtered } = applyStatusRules(input.status, this.statusRules);
      if (filtered) this.filtered += 1;
      else {
        this.tests.add(test);
        this.counts[status] += 1;
      }
      this.probara.addResult(input);
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

  /** A warning the first time, then at debug: the same problem tends to repeat in every test. */
  private warnOnce(message: string, title: string): void {
    if (this.warned.has(message)) {
      this.logger?.debug(`${message} (${title})`);
      return;
    }
    this.warned.add(message);
    this.logger?.warn(`${message} (first seen in ${title}; repeats are logged at debug)`);
  }

  /** One error line on stderr, without the token, even before the logger is known. */
  private logError(message: string): void {
    try {
      const raw: unknown = this.options;
      const options: Partial<ProbaraPlaywrightOptions> =
        typeof raw === 'object' && raw !== null ? raw : {};
      const env = options.env ?? process.env;
      const secrets = [options.apiToken, env.PROBARA_API_TOKEN]
        .map((secret) => (typeof secret === 'string' ? secret.trim() : ''))
        .filter((secret) => secret !== '');
      const logger =
        this.logger ?? options.logger ?? createConsoleLogger({ debug: false, stderr: true });
      logger.error(redact(message, secrets));
    } catch {
      // Logging must never break the test run either.
    }
  }

  /**
   * `Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped, 0 blocked)`, with the statuses
   * core sends (after `statusMapping`), and the attempts `statusFilter` leaves out, before core
   * logs the run.
   */
  private logResults(): void {
    // Core logs the results file it writes instead.
    if (this.probara?.enabled !== true) return;
    const { passed, failed, skipped, blocked } = this.counts;
    const results = passed + failed + skipped + blocked;
    if (results + this.filtered + this.ignored === 0) return;
    const left = [
      ...(this.filtered === 0 ? [] : [`; ${this.filtered} left out by statusFilter`]),
      ...(this.ignored === 0 ? [] : [`; ${this.ignored} ignored with probara.ignore()`]),
    ].join('');
    this.logger?.info(
      `Sending ${plural(results, 'result')} of ${plural(this.tests.size, 'test')} (${passed} passed, ${failed} failed, ${skipped} skipped, ${blocked} blocked)${left}`,
    );
  }
}
