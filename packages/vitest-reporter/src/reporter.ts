/**
 * The Vitest reporter: builds the results of a run from the reported tasks, once the run ended,
 * and sends them with `@probara/core`. It never throws into Vitest: every hook is guarded, and a
 * failure is logged on stderr, so the exit code of the user's run never changes because of it.
 */
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Reporter, TestModule, TestProject, Vitest } from 'vitest/node';
import {
  createAdapterSession,
  createReporter,
  followSessionReport,
  listRunCaseKeys,
  logAdapterError,
  type AdapterSession,
  type Logger,
  type ProbaraReporter,
  type ReportSummary,
} from '@probara/core';
import type { ConsoleEntry } from './attempts.js';
import { ConsoleKeeper } from './console-output.js';
import { probaraLogger, type LogSink } from './logger.js';
import { resolveSetup, type ProbaraVitestOptions, type Setup } from './options.js';
import { attachFile, type AttachContext } from './browser-attach.js';
import { ATTACH_COMMAND, type BrowserAttachRequest } from './browser-commands.js';
import {
  addBrowserCommands,
  registerProject,
  type BrowserConfigLike,
  type RegistrationOptions,
} from './register.js';
import { keepsCopiesOf, writesBlob } from './run-reporters.js';
import {
  createTestSelector,
  SELECTION_KEY,
  selectionValue,
  type RunCaseSelection,
  type TestSelector,
} from './run-selection.js';
import { factsOf, type ModuleFacts } from './tree.js';
import {
  failureToResultInput,
  toResultInput,
  type ReportedFailure,
  type ReportedTest,
  type TranslationContext,
} from './translate.js';
import { noticeOnce } from './notices.js';
import { watchRuns } from './watch-runs.js';
import { fileRulesOf, loadVite, type FileRules, type ViteModule } from './vite-rules.js';

/** The built files the reporter registers in each project: beside this module once built. */
const SETUP_FILE = fileURLToPath(new URL('./setup.js', import.meta.url));
const RUNNER_FILE = fileURLToPath(new URL('./runner.js', import.meta.url));
/** The browser setup file of Vitest 4.1 and later, and of Vitest 5 (V10). */
const BROWSER_SETUP_FILE = fileURLToPath(new URL('./setup-browser.js', import.meta.url));
/** The browser setup file of Vitest 3 and 4.0, whose browser commands and current test are another module (V10). */
const BROWSER_SETUP_V3_FILE = fileURLToPath(new URL('./setup-browser-v3.js', import.meta.url));

/** The browser setup file of a Vitest version: 3.x and 4.0.x take the file of their own modules, the rest the other. */
function browserSetupOf(version: string | undefined): string {
  return /^(3\.|4\.0\.)/u.test(version ?? '') ? BROWSER_SETUP_V3_FILE : BROWSER_SETUP_FILE;
}

/** The line a shard says once when the blob reporter is beside ours: the merge run reports the results (V-D4). */
const SHARDED_LINE =
  'Sharded run with the blob reporter: the results are reported by vitest --merge-reports';

/** The warning of `runCasesOnly` without a run to take the tests from: every test runs and is reported (J-J4). */
const SELECTION_RUN_MISSING =
  'runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported';

/** The warning of `runCasesOnly` in a sharded run with the blob reporter: the shards run every test, and the merge reports them. */
const SELECTION_SHARDED =
  'runCasesOnly does not apply to a sharded run with the blob reporter: every test runs, and vitest --merge-reports reports them all';

/** The warning of `runCasesOnly` when the cases of the run cannot be read: every test runs and is reported. */
function selectionFailed(run: string, reason: string): string {
  return `runCasesOnly: could not read the cases of the run ${run} (${reason}). Every test runs and is reported`;
}

/** The warning of `runCasesOnly` in a project whose setup file did not register: its tests run and are reported. */
function selectionSetupMissing(project: string): string {
  return `runCasesOnly needs the setup file in project "${project}": its tests run and are reported`;
}

/**
 * The configuration of the workspace project a browser project belongs to (Vitest keeps it in `_parent`), when it has a
 * browser section: Vitest builds the browser's parent from it, so the reporter's commands go there as well.
 */
function workspaceOf(project: object): BrowserConfigLike | undefined {
  const owner: unknown = Reflect.get(project, '_parent');
  const config: unknown =
    typeof owner === 'object' && owner !== null ? Reflect.get(owner, 'config') : undefined;
  if (typeof config !== 'object' || config === null) return undefined;
  return typeof Reflect.get(config, 'browser') === 'object'
    ? (config as BrowserConfigLike)
    : undefined;
}

/**
 * The parent browser that serves a browser project: Vitest keeps it in `_parentBrowser` of the project, or of the workspace
 * project the project belongs to (`_parent`, Vitest 3 and 4.1 for a workspace's projects), and a child `browser` names it as
 * `parent` once a run started. `undefined` when none exists yet.
 */
function browserParentOf(project: object): unknown {
  for (const owner of [project, Reflect.get(project, '_parent')]) {
    if (typeof owner !== 'object' || owner === null) continue;
    const parentBrowser: unknown = Reflect.get(owner, '_parentBrowser');
    if (parentBrowser !== undefined && parentBrowser !== null) return parentBrowser;
  }
  const browser: unknown = Reflect.get(project, 'browser');
  return typeof browser === 'object' && browser !== null
    ? Reflect.get(browser, 'parent')
    : undefined;
}

/** The warning of `runCasesOnly` in a browser project: its browser setup takes no selection (V-D102), so its tests run and are reported. */
function selectionBrowserUnsupported(project: string): string {
  return `runCasesOnly does not apply in browser mode yet: the tests of project "${project}" run and are reported`;
}

/** The ULID of the run `runCasesOnly` takes the tests from: `run.ulid`, else `PROBARA_RUN_ULID`. */
function selectionRunOf(setup: Setup): string {
  const { run, env } = setup.core;
  const given = run?.ulid ?? (env ?? process.env).PROBARA_RUN_ULID ?? '';
  return given.trim().toUpperCase();
}

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
  /** What was handed to core in the current run, for its `Sending N results` line, and the warnings given once in it. */
  private session: AdapterSession = createAdapterSession();
  /** The setup's session options: each run starts its own session from them (V-D117). */
  private sessionOptions: Parameters<typeof createAdapterSession>[0];
  /** The runs this reporter started: the session of onInit serves the first, and each later run gets its own (V-D122). */
  private runsStarted = 0;
  /**
   * The projects whose attempts could not be recorded: their own warning already says so, and their
   * retries are not counted again. The other projects of the run still warn about theirs.
   */
  private readonly degradedProjects = new Set<string>();
  /** The browser commands this reporter gives each browser project (V10: `probaraAttach`), set at registration and again at each run. */
  private browserCommands: Record<string, unknown> = {};
  /**
   * The projects whose provide refused the run selection: their workers keep no selection, so every test of them runs,
   * and the reporter must keep every result of them too (a filter here would drop what the workers ran).
   */
  private readonly unselectedProjects = new Set<string>();
  /**
   * The console logs of each test of the run, keyed by the test's id, while `captureOutput` is on (V-D9). They are
   * read once the run ended, so a merged run has the logs Vitest replays, as a live run has them.
   */
  private readonly consoleEntries = new Map<string, ConsoleKeeper>();
  /**
   * The folder the files of `probara.attach()` are copied into, for this run: under Vitest's attachments
   * folder, provided to the workers (V-D66). Removed once the run is sent, unless the run keeps them: a sharded
   * run, or one whose reporters may write a blob, has copies its blob names, which the `--merge-reports` run reads (R-V6).
   */
  private filesDir: string | undefined;
  private keepsFiles = false;
  /** Vitest's watch mode (`--watch`, `--ui`): the re-runs of the process report into one session's runs (V-D6). */
  private watch = false;
  /**
   * A shard whose reporters include the blob reporter: it prepares the workers and sends nothing, since the merge
   * run reports every shard's results from the blobs (V-D4).
   */
  private sharded = false;
  /** Whether the run has more than one Vitest project: then each result names its project (V-D84, R-V8). */
  private multipleProjects = false;
  /** The projects of the run, as Vitest lists them: the run's selection is provided to each one the setup file runs in. */
  private projects: TestProject[] = [];
  /** The selection `runCasesOnly` read for this run, and the selector that decides each test with it (V-D15). */
  private selection: { run: string; select: TestSelector } | undefined;
  /** What the selection matched in this run and what it left out, for the line `runCasesOnly` ends the report with. */
  private selectionCounts = { selected: 0, deselected: 0 };

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
      this.sessionOptions = {
        logger: setup.core.logger,
        statusRules: setup.statusRules,
        projectCodes: setup.projectCodes,
      };
      this.session = createAdapterSession(this.sessionOptions);
      for (const warning of setup.warnings) this.logger?.warn(warning);
      // Vitest resolves `attachmentsDir` for every run; without it, the files of `probara.attach()` are left out.
      const attachmentsDir: unknown = vitest.config.attachmentsDir;
      this.filesDir =
        typeof attachmentsDir === 'string'
          ? join(attachmentsDir, 'probara', randomUUID())
          : undefined;
      const reporters: unknown = vitest.config.reporters;
      this.keepsFiles = vitest.config.shard !== undefined || keepsCopiesOf(reporters);
      this.sharded = vitest.config.shard !== undefined && writesBlob(reporters);
      // `undefined` in a merge run, so it is read as unknown before the comparison.
      const watching: unknown = vitest.config.watch;
      this.watch = watching === true;
      // The configured projects of the run: one project's results need no name (R-V8, V-D84).
      this.projects = [...vitest.projects];
      this.multipleProjects = this.projects.length > 1;
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
      browserSetup: browserSetupOf(vitest.version),
      // The folder is read when the command runs: a watch restart re-creates the reporter, with its own folder (V-D66).
      browserCommands: {
        [ATTACH_COMMAND]: async (context: AttachContext, request: BrowserAttachRequest) => {
          const vite = await loadVite(context.project.config.root);
          return attachFile(this.filesDir, context, request, this.browserFileRules(vite));
        },
      },
    };
    this.browserCommands = options.browserCommands ?? {};
    for (const project of vitest.projects) {
      try {
        const registration = registerProject(project, options);
        if (!registration.setup) this.degradedProjects.add(project.name);
        for (const warning of registration.warnings) this.logger?.warn(warning);
        const workspace = project.config.browser.enabled ? workspaceOf(project) : undefined;
        if (workspace !== undefined && options.browserCommands !== undefined) {
          addBrowserCommands(workspace, options.browserCommands);
        }
      } catch (error) {
        this.logger?.warn(`could not register project "${project.name}": ${messageOf(error)}`);
      }
    }
  }

  /**
   * The file check of the run's Vite for a browser attach. A notice about it (an older check, or none) is logged once per
   * process, not once per run (V-D122), and an attach with no Vite gets no check, so it refuses with the reason (V-D119).
   */
  private browserFileRules(vite: ViteModule | undefined): FileRules | undefined {
    if (vite === undefined) return undefined;
    const { check, notice } = fileRulesOf(vite);
    if (notice !== undefined) noticeOnce(notice, this.logger);
    return check;
  }

  /**
   * Vitest calls it before the first file of a run runs: the run of this reporter starts here. A shard that writes a
   * blob sends nothing, so it starts no report (V-D4). In watch mode a run goes into the session's runs (V-D6).
   */
  async onTestRunStart(): Promise<void> {
    // The session of onInit serves the first run, so what was recorded before it is in that run's output (V-D122). Every
    // later run counts its own results: watch mode runs each re-run in this reporter, and its summary says what that
    // re-run sent. Jest's reporters are created for each run for the same reason (V-D117).
    if (this.runsStarted > 0) this.session = createAdapterSession(this.sessionOptions);
    this.runsStarted += 1;
    this.consoleEntries.clear();
    this.selection = undefined;
    if (this.sharded) {
      if (this.setup?.runCasesOnly === true) this.logger?.warn(SELECTION_SHARDED);
      return;
    }
    try {
      if (this.setup !== undefined) {
        this.probara = createReporter(
          this.watch ? watchRuns().options(this.setup.core) : this.setup.core,
        );
      }
    } catch (error) {
      this.probara = undefined;
      this.logError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`);
    }
    // Vitest awaits this hook before the workers run a file, so the selection is provided in time (V-D15).
    this.setBrowserCommands();
    await this.readSelection();
  }

  /**
   * Sets the reporter's browser commands on the parent browser of each browser project (V10). Vitest copies
   * `browser.commands` into the parent when the parent is created, and a parent created before this reporter starts (Vitest
   * 3 and 5) misses them. The browser context lists the commands its parent holds when a page first asks for them, so
   * setting them here, before the run's files run, is in time. The parent is `_parentBrowser` on every major (the child
   * `browser` exists only once a run has started). Read with `Reflect`: a missing property costs the command, not the run.
   */
  private setBrowserCommands(): void {
    for (const project of this.projects) {
      try {
        if (!project.config.browser.enabled) continue;
        const parent = browserParentOf(project);
        const commands: unknown =
          typeof parent === 'object' && parent !== null
            ? Reflect.get(parent, 'commands')
            : undefined;
        if (typeof commands !== 'object' || commands === null) continue;
        for (const [command, handler] of Object.entries(this.browserCommands)) {
          Reflect.set(commands, command, handler);
        }
      } catch (error) {
        // A Vitest that moved one of the fields read here costs this project's browser commands, with one warning: never the run.
        this.logger?.warn(
          `could not give the browser commands to project "${project.name}": ${messageOf(error)}`,
        );
      }
    }
  }

  /**
   * Reads the cases of the run `runCasesOnly` takes its tests from, and provides them to each project the setup file runs
   * in, before a file runs (V-D15). Read again at each run, so a watch re-run follows the cases of the run. A failure
   * provides no selection: every test runs and is reported, with one warning that says why. Never throws.
   */
  private async readSelection(): Promise<void> {
    const setup = this.setup;
    if (setup === undefined || !setup.runCasesOnly) return;
    try {
      // Reporting is off: nothing is reported, so every test runs.
      if (this.probara?.acceptsResults !== true) {
        this.provideSelection(undefined);
        return;
      }
      const run = selectionRunOf(setup);
      if (run === '') {
        this.logger?.warn(SELECTION_RUN_MISSING);
        this.provideSelection(undefined);
        return;
      }
      const summary = await listRunCaseKeys({ ...setup.core, run: { ulid: run } });
      if (summary.status !== 'listed') {
        this.logger?.warn(
          selectionFailed(run, summary.error?.message ?? 'reporting to Probara is off'),
        );
        this.provideSelection(undefined);
        return;
      }
      const selection: RunCaseSelection = {
        run,
        keys: summary.cases.flatMap(({ automationKey }) =>
          automationKey === null ? [] : [automationKey],
        ),
        caseIds: summary.cases.map(({ caseDisplayId }) => caseDisplayId),
        projectCodes: [...setup.projectCodes],
        keyIncludesFile: setup.keyIncludesFile,
        rootDir: setup.core.rootDir ?? '',
      };
      this.selection = { run, select: createTestSelector(selection) };
      this.provideSelection(selection);
    } catch (error) {
      // `listRunCaseKeys` never rejects; this only guards the reporter's own code.
      this.provideSelection(undefined);
      this.logError(`Could not read the cases of the run: ${messageOf(error)}`);
    }
  }

  /**
   * Provides the selection to each project the setup file runs in, or none (as `''`, which clears the last run's). A
   * project without the setup file keeps every test (warned once per run); a project that cannot take the value warns.
   */
  private provideSelection(selection: RunCaseSelection | undefined): void {
    const value = selectionValue(selection);
    for (const project of this.projects) {
      if (this.degradedProjects.has(project.name)) {
        if (selection !== undefined) {
          this.session.warnOnce(selectionSetupMissing(project.name), 'the run');
        }
        continue;
      }
      // A browser's setup takes no selection (V-D102): its tests run, and are reported as they run.
      if (project.config.browser.enabled) {
        this.unselectedProjects.add(project.name);
        if (selection !== undefined) {
          this.session.warnOnce(selectionBrowserUnsupported(project.name), 'the run');
        }
        continue;
      }
      try {
        project.provide(SELECTION_KEY, value);
        this.unselectedProjects.delete(project.name);
      } catch (error) {
        this.unselectedProjects.add(project.name);
        this.logger?.warn(
          `could not give project "${project.name}" the cases of the run (${messageOf(error)}): its tests all run and are reported`,
        );
      }
    }
  }

  /**
   * The selector `runCasesOnly` applies to a file: none in a project without the setup file, nor in one whose selection
   * could not be given (its tests run as they are, and are reported as they are).
   */
  private selectorFor(module: TestModule): TestSelector | undefined {
    if (this.selection === undefined) return undefined;
    const project = module.project.name;
    if (this.degradedProjects.has(project) || this.unselectedProjects.has(project)) {
      return undefined;
    }
    return this.selection.select;
  }

  /** The line `runCasesOnly` ends the report with: what the run's cases matched, and what was left out and not reported. */
  private logSelection(): void {
    const selection = this.selection;
    if (selection === undefined) return;
    const { selected, deselected } = this.selectionCounts;
    const tests = selected + deselected;
    if (tests === 0) return;
    if (selected === 0) {
      this.logger?.warn(
        `No test matches the cases of the run ${selection.run}: every test was skipped, and none is reported`,
      );
      return;
    }
    this.logger?.info(
      `Ran only the tests of run ${selection.run}: ${String(selected)} of ${String(tests)} tests match its cases; ${String(deselected)} skipped and not reported`,
    );
  }

  /**
   * A console log of the run (V-D9), kept with its test while `captureOutput` is on. Vitest prints it as before: the
   * reporter only listens. Never throws.
   */
  onUserConsoleLog(log: ReportedConsoleLog): void {
    try {
      if (this.setup?.captureOutput !== true || log.taskId === undefined) return;
      let kept = this.consoleEntries.get(log.taskId);
      if (kept === undefined) {
        kept = new ConsoleKeeper();
        this.consoleEntries.set(log.taskId, kept);
      }
      kept.add({ type: log.type, content: log.content, time: log.time });
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
      if (this.sharded) {
        this.logger?.info(SHARDED_LINE);
      } else if (this.probara?.acceptsResults === true) {
        this.reportRun(modules, unhandledErrors);
      }
      this.logResults();
      const summary = await this.probara?.complete();
      // The refused re-run is sent again before the copies go: the new run reads them too.
      if (this.watch && summary !== undefined && this.probara !== undefined) {
        await this.followWatchRuns(summary, this.probara);
      }
    } catch (error) {
      // `complete()` never rejects; this only guards the reporter's own code, and the re-send of a refused run.
      this.logError(`Could not finish reporting: ${messageOf(error)}`);
    } finally {
      // The copies go whatever failed above: a run that could not report must not leave them behind (never throws).
      await this.removeFiles();
    }
  }

  /**
   * Keeps the runs a re-run of the watch session reported into, and says once where every re-run reports. A run closed
   * (409) or deleted (404) meanwhile refuses the re-run: the session forgets it, and the results it did not record go
   * into a new run at once (never lost), unless the results file was written with them (sending them too would record
   * them twice). The follow-up is core's (V-D82); a failure of it is logged by `onTestRunEnd`.
   */
  private async followWatchRuns(summary: ReportSummary, sent: ProbaraReporter): Promise<void> {
    if (this.setup === undefined) return;
    await followSessionReport(
      watchRuns(),
      this.setup.core,
      { summary, sent, configured: this.setup.projectCodes[0] },
      this.logger,
    );
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
    this.selectionCounts = { selected: 0, deselected: 0 };
    const consoleOf = (taskId: string): readonly ConsoleEntry[] =>
      this.consoleEntries.get(taskId)?.entries ?? [];
    const context: TranslationContext = {
      filesDir: this.filesDir,
      multipleProjects: this.multipleProjects,
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
        facts = factsOf(
          module,
          root,
          consoleOf,
          this.selectorFor(module),
          this.setup?.attachScreenshots !== false,
        );
      } catch (error) {
        // The file's tree did not read: its results are lost, the others are not.
        this.logError(`Could not report ${module.moduleId}: ${messageOf(error)}`);
        continue;
      }
      if (facts.neverRan) neverRan += 1;
      if (!this.degradedProjects.has(module.project.name)) unrecorded += facts.unrecorded;
      droppedFiles += facts.droppedFiles;
      droppedOutput += facts.droppedOutput;
      this.selectionCounts.selected += facts.selected;
      this.selectionCounts.deselected += facts.deselected;
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
    this.logSelection();
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
