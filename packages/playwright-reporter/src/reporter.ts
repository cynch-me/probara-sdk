/** The Playwright reporter: translates Playwright's events into `@probara/core` results. */
import type { FullConfig, Reporter } from '@playwright/test/reporter';
import { createReporter, type ProbaraReporter, type ReporterOptions } from '@probara/core';
import { resolveSetup, type ProbaraPlaywrightOptions } from './options.js';

/**
 * Sends every test result of a Playwright run to Probara. Register it in `playwright.config`:
 * `reporter: [['list'], ['@probara/playwright-reporter']]`. It never throws into Playwright and
 * never changes Playwright's exit code: reporting failures are logged on stderr.
 */
export default class ProbaraPlaywrightReporter implements Reporter {
  private readonly options: ProbaraPlaywrightOptions;
  private probara: ProbaraReporter | undefined;

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
      this.probara = createReporter(setup.core);
    } catch {
      // A reporter must never break the test run.
    }
  }

  async onEnd(): Promise<void> {
    try {
      await this.probara?.complete();
    } catch {
      // `complete()` never rejects; this only guards the reporter's own code.
    }
  }
}
