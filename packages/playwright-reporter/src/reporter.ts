/** The Playwright reporter: translates Playwright's events into `@probara/core` results. */
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  createConsoleLogger,
  createReporter,
  redact,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
  type ResultStatus,
} from '@probara/core';
import { resolveSetup, type ProbaraPlaywrightOptions } from './options.js';
import { toResultInput, type TranslationContext } from './translate.js';

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
  private context: TranslationContext = { projectCode: undefined, captureOutput: false };
  private logger: Logger | undefined;
  private readonly tests = new Set<TestCase>();
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
      this.context = { projectCode: setup.projectCode, captureOutput: setup.captureOutput };
      this.logger = setup.core.logger;
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
      if (this.probara?.enabled !== true) return;
      const input = toResultInput(test, result, this.context);
      this.tests.add(test);
      this.counts[input.status] += 1;
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

  /** One error line on stderr, without the token, even before the logger is known. */
  private logError(message: string): void {
    try {
      const options: Partial<ProbaraPlaywrightOptions> =
        typeof this.options === 'object' && this.options !== null ? this.options : {};
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

  /** `Sending 3 results of 2 tests (1 passed, 1 failed, 1 skipped)`, before core logs the run. */
  private logResults(): void {
    const { passed, failed, skipped } = this.counts;
    const results = passed + failed + skipped;
    if (results === 0) return;
    this.logger?.info(
      `Sending ${plural(results, 'result')} of ${plural(this.tests.size, 'test')} (${passed} passed, ${failed} failed, ${skipped} skipped)`,
    );
  }
}
