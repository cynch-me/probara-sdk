/**
 * The Vitest reporter: builds the results of a run from the reported tasks, once the run ended,
 * and sends them with `@probara/core`. It never throws into Vitest: every hook is guarded, and a
 * failure is logged on stderr, so the exit code of the user's run never changes because of it.
 */
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Reporter, TestModule, Vitest } from 'vitest/node';
import {
  createAdapterSession,
  createReporter,
  logAdapterError,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
} from '@probara/core';
import type { ConsoleEntry } from './attempts.js';
import { probaraLogger, type LogSink } from './logger.js';
import { resolveSetup, type ProbaraVitestOptions, type Setup } from './options.js';
import { registerProject, type RegistrationOptions } from './register.js';
import { factsOf, type ModuleFacts } from './tree.js';
import {
  failureToResultInput,
  toResultInput,
  type ReportedFailure,
  type ReportedTest,
  type TranslationContext,
} from './translate.js';

/** The built files the reporter registers in each project: beside this module once built. */
const SETUP_FILE = fileURLToPath(new URL('./setup.js', import.meta.url));
const RUNNER_FILE = fileURLToPath(new URL('./runner.js', import.meta.url));

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether the run writes a blob: the `blob` reporter is registered, by its name alone or with options. Another run
 * merges the blob, and reads the copies of `probara.attach()` where the blob names them (V-D66, R-V6).
 */
function writesBlob(reporters: unknown): boolean {
  if (!Array.isArray(reporters)) return false;
  return reporters.some((reporter: unknown) => {
    const name: unknown = Array.isArray(reporter) ? (reporter as unknown[])[0] : reporter;
    return name === 'blob';
  });
}

/** The identity of a test within the run, for the `Sending N results of M tests` count. */
function testOf(test: ReportedTest): string {
  return JSON.stringify([test.file, ...test.ancestors, test.title]);
}

/** The warning of files Vitest never ran: they have no test to report. */
function neverRanWarning(count: number): string {
  return `Vitest did not run ${count} test ${count === 1 ? 'file' : 'files'} of this run: nothing of ${count === 1 ? 'it is' : 'them are'} reported`;
}

/** The warning of tests Vitest retried or repeated, whose attempts were not recorded: only the last is sent. */
function unrecordedWarning(count: number): string {
  return `Vitest retried or repeated ${count} test${count === 1 ? '' : 's'} whose earlier attempts were not recorded: only ${count === 1 ? 'its final attempt is' : 'their final attempts are'} reported`;
}

/**
 * The warning of annotated files left out: the attempt each belongs to cannot be told apart, because the test was
 * retried or repeated without recorded attempts, or an attempt kept no count of its annotations (V-D68, R-V6).
 */
function droppedFilesWarning(count: number): string {
  return `${count} annotated file${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} left out: the attempt each belongs to cannot be told apart`;
}

/**
 * The warning of console output left out: Vitest attributes the writes of concurrent tests to the wrong test, and the
 * attempts of a retried or repeated test without recorded attempts cannot be told apart (V-D9, R-V6).
 */
function droppedOutputWarning(count: number): string {
  return `The console output of ${count} test${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} left out: Vitest attributes the writes of concurrent tests to the wrong test, and the attempts of a retried or repeated test without recorded attempts cannot be told apart`;
}

/** A console log as Vitest sends it to the reporter (`onUserConsoleLog`): the fields the reporter reads. */
interface ReportedConsoleLog {
  type: 'stdout' | 'stderr';
  content: string;
  time: number;
  taskId?: string | undefined;
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
  /**
   * The projects whose attempts could not be recorded: their own warning already says so, and their
   * retries are not counted again. The other projects of the run still warn about theirs.
   */
  private readonly degradedProjects = new Set<string>();
  /**
   * The console logs of each test of the run, keyed by the test's id, while `captureOutput` is on (V-D9). They are
   * read once the run ended, so a merged run has the logs Vitest replays, as a live run has them.
   */
  private readonly consoleEntries = new Map<string, ConsoleEntry[]>();
  /**
   * The folder the files of `probara.attach()` are copied into, for this run: under Vitest's attachments
   * folder, provided to the workers (V-D66). Removed once the run is sent, unless the run keeps them: a sharded
   * run, or one that writes a blob, has copies its blob names, which the `--merge-reports` run reads (R-V6).
   */
  private filesDir: string | undefined;
  private keepsFiles = false;

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
      // Vitest resolves `attachmentsDir` for every run; without it, the files of `probara.attach()` are left out.
      const attachmentsDir: unknown = vitest.config.attachmentsDir;
      this.filesDir =
        typeof attachmentsDir === 'string'
          ? join(attachmentsDir, 'probara', randomUUID())
          : undefined;
      const reporters: unknown = vitest.config.reporters;
      this.keepsFiles = vitest.config.shard !== undefined || writesBlob(reporters);
      this.registerProjects(vitest);
    } catch (error) {
      // A reporter must never break the test run: nothing is reported, and the log says why.
      this.setup = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
  }

  /**
   * Registers the setup file and the runner extension in each project (V-D5, V-D7). A project that
   * cannot be changed degrades with a warning, and the others are still registered: nothing here
   * ever turns reporting off or fails the run.
   */
  private registerProjects(vitest: Vitest): void {
    const options: RegistrationOptions = {
      setup: SETUP_FILE,
      runner: RUNNER_FILE,
      canImportTypeScript: Boolean(process.features.typescript),
      filesDir: this.filesDir,
    };
    for (const project of vitest.projects) {
      try {
        const registration = registerProject(project, options);
        if (!registration.setup) this.degradedProjects.add(project.name);
        for (const warning of registration.warnings) this.logger?.warn(warning);
      } catch (error) {
        this.logger?.warn(`could not register project "${project.name}": ${messageOf(error)}`);
      }
    }
  }

  /** Vitest calls it before the first file of a run runs: the run of this reporter starts here. */
  onTestRunStart(): void {
    this.consoleEntries.clear();
    try {
      if (this.setup !== undefined) this.probara = createReporter(this.setup.core);
    } catch (error) {
      this.probara = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
  }

  /**
   * A console log of the run (V-D9), kept with its test while `captureOutput` is on. Vitest prints it as before: the
   * reporter only listens. Never throws.
   */
  onUserConsoleLog(log: ReportedConsoleLog): void {
    try {
      if (this.setup?.captureOutput !== true || log.taskId === undefined) return;
      const entries = this.consoleEntries.get(log.taskId) ?? [];
      entries.push({ type: log.type, content: log.content, time: log.time });
      this.consoleEntries.set(log.taskId, entries);
    } catch (error) {
      this.logError(`Could not keep the console output of a test: ${messageOf(error)}`);
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
      await this.removeFiles();
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    }
  }

  /**
   * Removes the copies of this run, once the run is sent (core has read them, or copied them into a results
   * file). A run that keeps them, sharded or writing a blob, leaves them for the merge (V-D66). Never throws.
   */
  private async removeFiles(): Promise<void> {
    if (this.filesDir === undefined || this.keepsFiles) return;
    try {
      await rm(this.filesDir, { recursive: true, force: true });
    } catch (error) {
      this.logError(`Could not remove the attachment copies of this run: ${messageOf(error)}`);
    }
  }

  /** Builds the results of every file of the run and hands them to core, in file order. */
  private reportRun(
    modules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<unknown>,
  ): void {
    const setup = this.setup;
    if (setup === undefined) return;
    let unrecorded = 0;
    let droppedFiles = 0;
    let droppedOutput = 0;
    const consoleOf = (taskId: string): readonly ConsoleEntry[] =>
      this.consoleEntries.get(taskId) ?? [];
    const context: TranslationContext = {
      filesDir: this.filesDir,
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
        facts = factsOf(module, root, consoleOf);
      } catch (error) {
        // The file's tree did not read: its results are lost, the others are not.
        this.logError(`Could not report ${module.moduleId}: ${messageOf(error)}`);
        continue;
      }
      if (facts.neverRan) neverRan += 1;
      if (!this.degradedProjects.has(module.project.name)) unrecorded += facts.unrecorded;
      droppedFiles += facts.droppedFiles;
      droppedOutput += facts.droppedOutput;
      for (const failure of facts.failures) this.reportFailure(failure, context);
      for (const test of facts.tests) this.reportTest(test, context);
    }
    if (neverRan > 0) this.session.warnOnce(neverRanWarning(neverRan), 'the run');
    if (unrecorded > 0) {
      this.session.warnOnce(unrecordedWarning(unrecorded), 'the run');
    }
    if (droppedFiles > 0) this.session.warnOnce(droppedFilesWarning(droppedFiles), 'the run');
    if (droppedOutput > 0) this.session.warnOnce(droppedOutputWarning(droppedOutput), 'the run');
    if (unhandledErrors.length > 0) {
      this.session.warnOnce(unhandledWarning(unhandledErrors.length), 'the run');
    }
  }

  private reportTest(test: ReportedTest, context: TranslationContext): void {
    try {
      const input = toResultInput(test, context);
      // An attempt `probara.ignore()` left out is no result: core's summary says how many, and it is not sent.
      if (input === undefined) {
        this.session.countIgnored();
        return;
      }
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
