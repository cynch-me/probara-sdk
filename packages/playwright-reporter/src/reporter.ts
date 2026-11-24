/** The Playwright reporter: translates Playwright's events into `@probara/core` results. */
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  buildAutomationKey,
  createAdapterSession,
  createReporter,
  logAdapterError,
  uploadSnapScreenshots,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
  type ReporterOptions,
  type SnapScreenshotInput,
  type TestResultInput,
} from '@probara/core';
import { resolveSetup, type ProbaraPlaywrightOptions } from './options.js';
import { CASE_ANNOTATION } from './metadata.js';
import { readSnapScreenshots } from './snap.js';
import { annotationsOf, toAttempt, type TranslationContext } from './translate.js';
import { VERSION } from './version.js';

/** The most a screenshot says about its test: the limits of the Snap API. */
const MAX_SNAP_TITLE_SEGMENTS = 50;
const MAX_SNAP_TEXT_LENGTH = 1024;
const MAX_SNAP_CASE_IDS = 20;

const SNAP_OPTION_MISSING =
  'This sharded run sends Probara Snap screenshots without the snap option: set snap: true (PROBARA_SNAP=true) in every shard, or the build will not complete when a shard takes no screenshot';

/**
 * `config.shard` as Probara Snap counts it, the index from 0: none for a run without shards, a
 * merge of blob reports, or a Playwright that does not say.
 */
function snapShardOf(config: {
  shard?: FullConfig['shard'];
}): { index: number; total: number } | undefined {
  const { shard } = config;
  return shard === null || shard === undefined
    ? undefined
    : { index: shard.current - 1, total: shard.total };
}

const SNAP_SDK = { name: '@probara/playwright-reporter', version: VERSION };

/** What a screenshot says of its test beyond the result: where it is declared, its retries, annotations and tags. */
function snapTestFactsOf(
  test: TestCase,
  result: TestResult,
): Partial<NonNullable<SnapScreenshotInput['test']>> {
  const { line, column } = test.location;
  const annotations = annotationsOf(test, result)
    .filter(({ type }) => type !== CASE_ANNOTATION)
    .map(({ type, description }) => (description === undefined ? { type } : { type, description }));
  const tags = (test as { tags?: readonly string[] }).tags ?? [];
  return {
    line,
    column,
    retries: test.retries,
    ...(annotations.length === 0 ? {} : { annotations }),
    ...(tags.length === 0 ? {} : { tags: [...tags] }),
  };
}

/** The test of a screenshot: its key and cases as the report sends them, and the attempt. */
function snapTestOf(
  input: TestResultInput,
  retry: number,
  rootDir: string | undefined,
): NonNullable<SnapScreenshotInput['test']> {
  const { identity } = input;
  const ids = [
    ...(input.caseDisplayId === undefined ? [] : [input.caseDisplayId]),
    ...(input.caseDisplayIds ?? []),
  ].slice(0, MAX_SNAP_CASE_IDS);
  const automationKey =
    input.automationKey ?? buildAutomationKey(identity, rootDir === undefined ? {} : { rootDir });
  return {
    automationKey,
    ...(ids.length === 0 ? {} : { caseDisplayIds: ids }),
    titlePath: identity.titlePath
      .slice(0, MAX_SNAP_TITLE_SEGMENTS)
      .map((segment) => segment.slice(0, MAX_SNAP_TEXT_LENGTH)),
    ...(identity.file === undefined ? {} : { file: identity.file.slice(0, MAX_SNAP_TEXT_LENGTH) }),
    retry,
  };
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
  /** What was handed to core, for the `Sending N results` line, and the warnings given once. */
  private session: AdapterSession = createAdapterSession();
  /** Core's options once the run began: the connection the Snap upload shares with the reports. */
  private core: ReporterOptions | undefined;
  /** The Snap build name and nonce of the options, when set. */
  private snapBuild: { buildName?: string; nonce?: string } = {};
  /** The `snap` option: a shard of a sharded run is sent even without screenshots. */
  private snap = false;
  /** The Playwright of the run, as the automation library of each screenshot. */
  private automationLibrary: SnapScreenshotInput['automationLibrary'];
  /** `config.shard` as Probara Snap counts it: the index from 0. */
  private shard: { index: number; total: number } | undefined;
  /** The Snap screenshots of the last attempt of each test, by test, in the order they ended. */
  private readonly snaps = new Map<string, SnapScreenshotInput[]>();

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
      this.core = setup.core;
      this.snapBuild = {
        ...(setup.snapBuildName === undefined ? {} : { buildName: setup.snapBuildName }),
        ...(setup.snapNonce === undefined ? {} : { nonce: setup.snapNonce }),
      };
      this.snap = setup.snap;
      this.shard = snapShardOf(config);
      this.automationLibrary =
        typeof config.version === 'string' && config.version !== ''
          ? { name: '@playwright/test', version: config.version }
          : undefined;
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
      this.collectSnaps(test, result, attempt.input);
    } catch (error) {
      // A reporter must never break the test run: this attempt is lost, and the log says why.
      this.logError(`Could not report an attempt of ${titleOf(test)}: ${messageOf(error)}`);
    }
  }

  async onEnd(): Promise<void> {
    try {
      this.logResults();
      const summary = await this.probara?.complete();
      await this.uploadSnaps(summary?.run?.ulid);
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    }
  }

  /**
   * Keeps the Snap screenshots of this attempt as those of its test: a retry takes them again, so
   * the last attempt replaces the ones before. Nothing is kept while reporting is off.
   */
  private collectSnaps(test: TestCase, result: TestResult, input: TestResultInput): void {
    if (this.probara?.enabled !== true) return;
    const screenshots = readSnapScreenshots(result.attachments);
    const key = (test as { id?: string }).id ?? JSON.stringify(test.titlePath());
    if (screenshots.length === 0) {
      this.snaps.delete(key);
      return;
    }
    const taken = {
      ...snapTestOf(input, result.retry, this.core?.rootDir),
      ...snapTestFactsOf(test, result),
    };
    const automationLibrary = this.automationLibrary;
    this.snaps.delete(key);
    this.snaps.set(
      key,
      screenshots.map((screenshot, captureIndex) => ({
        ...screenshot,
        ...(automationLibrary === undefined ? {} : { automationLibrary }),
        test: { ...taken, captureIndex },
      })),
    );
  }

  /**
   * Sends the screenshots as one shard of a Snap build; core logs the build or the failure. With
   * the `snap` option, a shard of a sharded run is sent without screenshots too: its build waits
   * for every shard. Without it, a run that took none sends and logs nothing.
   */
  private async uploadSnaps(runUlid: string | undefined): Promise<void> {
    const screenshots = [...this.snaps.values()].flat();
    const sharded = this.shard !== undefined && this.shard.total > 1;
    if (this.core === undefined || (screenshots.length === 0 && !(sharded && this.snap))) return;
    if (sharded && !this.snap) this.logger?.warn(SNAP_OPTION_MISSING);
    await uploadSnapScreenshots({
      ...this.core,
      ...this.snapBuild,
      sdk: SNAP_SDK,
      screenshots,
      ...(this.shard === undefined ? {} : { shard: this.shard }),
      ...(runUlid === undefined ? {} : { runUlid }),
    });
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
