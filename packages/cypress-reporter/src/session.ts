/**
 * The state one `cypress run` shares between its two entry points: the reporter Cypress creates
 * per spec, and the `probaraNodeEvents` plugin. Cypress runs both in the Node process that starts
 * the run, so the state of this module is the only channel between them: nothing is resolved
 * twice, and no problem is logged twice. A second Cypress run is a new process, and gets its own.
 */
import {
  attemptKey,
  createAdapterSession,
  createReporter,
  detailsOf,
  listRunCaseKeys,
  logAdapterError,
  redact,
  type AdapterSession,
  type AttemptDetails,
  type AttemptRef,
  type Logger,
  type ProbaraReporter,
  type ReportSummary,
  type RunSelection,
  type TestResultInput,
} from '@probara/core';
import type { CypressSpecResults } from './cypress.js';
import type { CypressTestNames } from './identity.js';
import { resolveSetup, type ProbaraCypressOptions, type Setup } from './options.js';
import { testIdOf, toResultInput, type TranslationContext } from './translate.js';

/** A line of the transport that belongs to an attempt (the others describe a file, or a warning). */
export type AttemptLine = Parameters<typeof detailsOf>[0][number];

/** A screenshot Cypress took for one attempt of one test. */
export interface SpecScreenshot {
  /** The file, as the plugin's `after:screenshot` named it. */
  path: string;
  /** Its name without the extension: the titles of the test, joined the way Cypress joins them. */
  name: string;
}

/** What the plugin needs from the reporter that is running a spec. */
export interface SpecReporter {
  /** The spec it reports, relative to the project root. */
  readonly spec: string;
  /** Whether the spec reported a result already: a spec with none, that failed, needs its own. */
  hasResults(): boolean;
  /** The video of the spec arrived: sends the results that were waiting for it. */
  setVideo(path: string | undefined): void;
  /** Sends what the spec still holds, whatever it was waiting for: the run is over. */
  forceFlush(): void;
}

/**
 * The title of the failed result of a spec Cypress could not run at all: the Cypress analogue of
 * the failed test jest-junit writes for a test file it could not run, so a broken spec is never
 * silently green.
 */
export const SPEC_FAILED_TO_RUN = 'Spec failed to run';

/** The warning of `runCasesOnly` without a run to take the tests from. */
export const SELECTION_RUN_MISSING =
  'runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported';

/** What each reason the run's cases could not be read says. */
function selectionFailed(run: string, reason: string): string {
  return `runCasesOnly: could not read the cases of the run ${run} (${reason}). Every test runs and is reported`;
}

/** The ULID of the run `runCasesOnly` takes the tests from: `run.ulid`, else `PROBARA_RUN_ULID`. */
function selectionRunOf(setup: Setup): string {
  const { run, env } = setup.core;
  return (run?.ulid ?? (env ?? process.env).PROBARA_RUN_ULID ?? '').trim().toUpperCase();
}

/** The one line of an interactive session, naming the run that stays open. */
export function interactiveRunLine(projectId: string, ulid: string, displayId: string): string {
  return `Interactive mode: every spec of this session reports into ${displayId} of ${projectId}, which stays open: close it in Probara, or with probara run close --project ${projectId} --run-ulid ${ulid}`;
}

/**
 * The options Cypress hands a reporter, unwrapped the way both entry points read them: the
 * `reporterOptions` of what it passes, then the one key `cypress-multi-reporters` wraps the
 * options in (`{ '@probara/cypress-reporter': { … } }`). Anything else is given back as it is, and
 * core turns reporting off for what it cannot read.
 */
export function reporterOptionsOf(options: unknown): unknown {
  if (typeof options !== 'object' || options === null) return options;
  const { reporterOptions } = options as { reporterOptions?: unknown };
  const inner = reporterOptions === undefined ? options : reporterOptions;
  if (typeof inner !== 'object' || inner === null) return inner;
  const keys = Object.keys(inner);
  const wrapped = keys.length === 1 ? keys[0] : undefined;
  return wrapped?.startsWith('@probara/') === true
    ? (inner as Record<string, unknown>)[wrapped]
    : inner;
}

/** What the session remembers, none of it read outside this module. */
interface SessionState {
  options: unknown;
  setup: Setup | undefined;
  /** The options could not be read at all: never read them again. */
  unusable: boolean;
  logger: Logger | undefined;
  adapter: AdapterSession;
  reporter: ProbaraReporter | undefined;
  completing: Promise<ReportSummary | undefined> | undefined;
  interactive: boolean;
  browser: string | undefined;
  /** The spec Cypress is running. */
  spec: string | undefined;
  /** The attempt the browser's `probara.*` calls belong to. */
  current: AttemptRef | undefined;
  lines: Map<string, AttemptLine[]>;
  screenshots: Map<string, SpecScreenshot[]>;
  videos: Map<string, string>;
  reporters: Map<string, SpecReporter>;
  /** The cases of the run of `runCasesOnly`, read once by whoever asks first. */
  selection: Promise<RunSelection | undefined> | undefined;
  /** A Cypress run constructed a reporter, and one registered `setupNodeEvents`. */
  reporterSeen: boolean;
  pluginSeen: boolean;
  /** The run completes on the process's way out, for a run without the plugin. */
  armed: boolean;
}

function newState(): SessionState {
  return {
    options: undefined,
    setup: undefined,
    unusable: false,
    logger: undefined,
    adapter: createAdapterSession(),
    reporter: undefined,
    completing: undefined,
    interactive: false,
    browser: undefined,
    spec: undefined,
    current: undefined,
    lines: new Map(),
    screenshots: new Map(),
    videos: new Map(),
    reporters: new Map(),
    selection: undefined,
    reporterSeen: false,
    pluginSeen: false,
    armed: false,
  };
}

let state: SessionState = newState();

/**
 * The setup of the run, resolved once by whoever gets there first: the plugin (which knows
 * `projectRoot`) runs before the first spec, the reporter of a spec without it.
 */
function resolve(options: unknown, rootDir: string): Setup | undefined {
  if (state.setup !== undefined || state.unusable) return state.setup;
  state.options = options;
  try {
    const given = reporterOptionsOf(options);
    if (typeof given !== 'object' || given === null) {
      state.unusable = true;
      return undefined;
    }
    const setup = resolveSetup(given as ProbaraCypressOptions, rootDir);
    state.setup = setup;
    state.logger = setup.core.logger;
    state.adapter = createAdapterSession({
      logger: setup.core.logger,
      statusRules: setup.statusRules,
      projectCodes: setup.projectCodes,
    });
    for (const warning of setup.warnings) state.logger?.warn(warning);
    return setup;
  } catch (error) {
    // A reporter must never break the test run: nothing is reported, and the log says why.
    state.unusable = true;
    logAdapterError(`Probara reporting is off: the reporter could not start: ${messageOf(error)}`, options);
    return undefined;
  }
}

/** The reporter of the process: core's, built once with the options of the resolved setup. */
function reporterOf(): ProbaraReporter | undefined {
  if (state.reporter !== undefined) return state.reporter;
  const setup = state.setup;
  if (setup === undefined) return undefined;
  try {
    state.reporter = createReporter(
      state.interactive ? { ...setup.core, closeRun: false, closeRuns: undefined } : setup.core,
    );
  } catch (error) {
    state.reporter = undefined;
    logAdapterError(
      `Probara reporting is off: the reporter could not start: ${messageOf(error)}`,
      state.options,
      state.logger,
    );
  }
  return state.reporter;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const session = {
  /**
   * The setup of the run, resolved once from the options Cypress hands either entry point, with
   * `rootDir` the directory spec files are reported relative to.
   */
  setup(options: unknown, rootDir: string): Setup | undefined {
    return resolve(options, rootDir);
  },

  /** The resolved setup of the run, when there is one. */
  resolved(): Setup | undefined {
    return state.setup;
  },

  /** The options Cypress handed either entry point, to read the cases of a run with, or to redact. */
  options(): unknown {
    return state.options;
  },

  /** Where the reporter writes, once its setup is resolved. */
  logger(): Logger | undefined {
    return state.logger;
  },

  /** The counts and the warnings of the run, for the `Sending N results of M tests` line. */
  adapter(): AdapterSession {
    return state.adapter;
  },

  /** A warning the first time, then at debug: the same problem tends to repeat in every test. */
  warnOnce(message: string, where: string): void {
    state.adapter.warnOnce(message, where);
  },

  /** One error line on stderr, without the token, even before the setup is known. */
  logError(message: string): void {
    logAdapterError(message, state.options, state.logger);
  },

  /** Hands one result to core, counted as core sends it (mapped by statusMapping, then filtered). */
  addResult(input: TestResultInput, test: unknown): void {
    if (reporterOf()?.acceptsResults !== true) return;
    state.adapter.count(input, test);
    state.reporter?.addResult(input);
  },

  /** Counts a result `probara.ignore()` left out. */
  countIgnored(): void {
    state.adapter.countIgnored();
  },

  /** Whether anything of this run is reported, or could be: the results file counts too. */
  reporting(): boolean {
    return reporterOf()?.acceptsResults === true;
  },

  /** Completes the run, once: the same summary on every later call. Never rejects. */
  complete(): Promise<ReportSummary | undefined> {
    if (state.completing !== undefined) return state.completing;
    // The run is over: a spec still waiting for its video sends what it reported rather than
    // losing it.
    for (const spec of state.reporters.values()) {
      try {
        spec.forceFlush();
      } catch {
        // A reporter that cannot flush its spec is left out; core logs what it did not send.
      }
    }
    const reporter = reporterOf();
    if (reporter === undefined) {
      state.completing = Promise.resolve(undefined);
      return state.completing;
    }
    // Core logs the results file it writes instead of the line with the counts.
    if (reporter.enabled) {
      const line = state.adapter.summaryLine();
      if (line !== undefined) state.logger?.info(line);
    }
    state.completing = reporter
      .complete()
      .then((summary) => {
        session.logInteractiveRun(summary);
        return summary;
      })
      .catch(() => undefined);
    return state.completing;
  },

  /** Names the run of an interactive session once, and how to close it. */
  logInteractiveRun(summary: ReportSummary | undefined): void {
    if (!state.interactive || summary === undefined) return;
    for (const project of summary.projects) {
      const { ulid, displayId } = project.run ?? {};
      if (ulid === undefined || displayId === undefined) continue;
      state.logger?.info(interactiveRunLine(project.projectId, ulid, displayId));
    }
  },

  /**
   * Completes the run on the process's way out, armed once by the first reporter: a run whose
   * plugin never fired `after:run` still sends everything it reported.
   */
  armBeforeExit(): void {
    if (state.armed) return;
    state.armed = true;
    process.once('beforeExit', () => {
      void session.complete();
    });
  },

  /** `cypress open`: one run per session, which stays open. */
  interactive(): boolean {
    return state.interactive;
  },

  /** Marks the session interactive, from the plugin config (`config.isInteractive`). */
  setInteractive(interactive: boolean): void {
    state.interactive = interactive;
  },

  /** The browser the run uses (`electron`), sent as a parameter of every result. */
  browser(): string | undefined {
    return state.browser;
  },

  /** Remembers the browser `before:run` announced. */
  setBrowser(name: string | undefined): void {
    state.browser = name;
  },

  /** The key of the channel lines of an attempt: its spec, its full title and its attempt. */
  attemptKeyOf(spec: string, test: CypressTestNames, attempt: number): string {
    return attemptKey(spec, [...test.suiteTitles, test.title].join(' '), attempt);
  },

  /** `before:spec`: the spec Cypress begins, whose screenshots and helpers follow. */
  beginSpec(spec: string): void {
    state.spec = spec;
    state.current = undefined;
  },

  /** The spec Cypress is running. */
  currentSpec(): string | undefined {
    return state.spec;
  },

  /**
   * Records what one `cy.task('probara', …)` sent about the attempt that is running, stamped with
   * that attempt. A call with no test running belongs to no result: it is dropped, once with a
   * warning.
   */
  addLine(body: Record<string, unknown>): void {
    const ref = state.current;
    if (ref === undefined) {
      state.adapter.warnOnce(
        'Ignored a probara.* call with no test running: the helpers belong to a test, in a spec',
        'a probara task',
      );
      return;
    }
    const key = session.attemptKeyOf(ref.file, { suiteTitles: [], title: ref.test }, ref.attempt);
    const lines = state.lines.get(key) ?? [];
    lines.push({ ...body, ...ref } as AttemptLine);
    state.lines.set(key, lines);
  },

  /** What the helpers said about one attempt, read into the parts of a result. */
  detailsOf(key: string): AttemptDetails {
    return detailsOf(state.lines.get(key) ?? [], process.cwd());
  },

  /** Forgets what the helpers said about an attempt: it goes with its result. */
  forgetLines(key: string): void {
    state.lines.delete(key);
  },

  /** The attempt the browser's `probara.*` calls belong to, as the reporter stamps it. */
  setCurrentAttempt(ref: AttemptRef | undefined): void {
    state.current = ref;
  },

  /** Remembers a screenshot Cypress took, named the way it names it. */
  addScreenshot(spec: string, path: string): void {
    const shots = state.screenshots.get(spec) ?? [];
    shots.push({ path, name: baseNameOf(path) });
    state.screenshots.set(spec, shots);
  },

  /** Every screenshot of a spec, in the order Cypress took them. */
  screenshotsOf(spec: string): readonly SpecScreenshot[] {
    return state.screenshots.get(spec) ?? [];
  },

  /** Remembers the video of a spec (`after:spec`), or that it has none. */
  addVideo(spec: string, video: string | null | undefined): void {
    if (typeof video === 'string' && video !== '') state.videos.set(spec, video);
  },

  /** The video of a spec, once `after:spec` gave it. */
  videoOf(spec: string): string | undefined {
    return state.videos.get(spec);
  },

  /** Registers the reporter that is running a spec, for the plugin to hand the video to. */
  setSpecReporter(reporter: SpecReporter): void {
    state.reporterSeen = true;
    state.reporters.set(reporter.spec, reporter);
  },

  /** The reporter that ran a spec, when one did. */
  specReporter(spec: string): SpecReporter | undefined {
    return state.reporters.get(spec);
  },

  /** Whether a Cypress run constructed a reporter of this package. */
  reporterSeen(): boolean {
    return state.reporterSeen;
  },

  /** Records that `probaraNodeEvents` ran, so no warning of a missing reporter is due. */
  setPluginSeen(): void {
    state.pluginSeen = true;
  },

  /** Whether `probaraNodeEvents` ran. */
  pluginSeen(): boolean {
    return state.pluginSeen;
  },

  /** `after:spec`: the video of the spec, and the failure of a spec that could not run at all. */
  afterSpec(spec: string, results: CypressSpecResults): void {
    session.addVideo(spec, results.video);
    const reporter = state.reporters.get(spec);
    if (reporter !== undefined) {
      reporter.setVideo(session.videoOf(spec));
      return;
    }
    // Cypress never constructs a reporter for a spec it could not run: without this result it
    // would show green in Probara.
    if ((results.stats?.failures ?? 0) > 0) session.reportSpecFailure(spec);
  },

  /**
   * The cases of the run `runCasesOnly` takes the tests from, read once by whoever asks first, or
   * `undefined` after one warning when they cannot be read: every test then runs and is reported.
   * Never rejects.
   */
  readSelection(): Promise<RunSelection | undefined> {
    state.selection ??= readSelection();
    return state.selection;
  },

  /**
   * The one failed result of a spec that could not run at all (a syntax error): keyed with the
   * spec and this title, like every other result.
   */
  reportSpecFailure(spec: string): void {
    const setup = state.setup;
    if (setup === undefined || reporterOf()?.acceptsResults !== true) return;
    const names: CypressTestNames = { suiteTitles: [], title: SPEC_FAILED_TO_RUN };
    const context: TranslationContext = {
      projectCodes: setup.projectCodes,
      keyIncludesFile: setup.keyIncludesFile,
      rootDir: setup.core.rootDir ?? process.cwd(),
    };
    session.addResult(
      toResultInput(spec, { ...names, outcome: 'fail' }, context, Date.now()),
      testIdOf(spec, names),
    );
  },

  /** Forgets everything of a run: what a test of this module starts from. */
  reset(): void {
    state = newState();
  },
};

/** Reads the cases of the run `runCasesOnly` names, once, warning about what it cannot. */
async function readSelection(): Promise<RunSelection | undefined> {
  const setup = state.setup;
  // Reporting is off: nothing is reported, and every test runs.
  if (setup === undefined || reporterOf()?.acceptsResults !== true) return undefined;
  let run = '';
  try {
    run = selectionRunOf(setup);
    if (run === '') {
      state.logger?.warn(SELECTION_RUN_MISSING);
      return undefined;
    }
    const summary = await listRunCaseKeys({ ...setup.core, run: { ulid: run } });
    if (summary.status !== 'listed') {
      state.logger?.warn(
        selectionFailed(run, summary.error?.message ?? 'reporting to Probara is off'),
      );
      return undefined;
    }
    return {
      run,
      keys: summary.cases.flatMap(({ automationKey }) =>
        automationKey === null ? [] : [automationKey],
      ),
      caseIds: summary.cases.map(({ caseDisplayId }) => caseDisplayId),
      projectCodes: setup.projectCodes,
      keyIncludesFile: setup.keyIncludesFile,
      rootDir: setup.core.rootDir ?? process.cwd(),
    };
  } catch (error) {
    // Only a guard: core refuses a malformed run.ulid, and listRunCaseKeys never rejects.
    const { apiToken, env } = setup.core;
    const secrets = [apiToken, (env ?? process.env).PROBARA_API_TOKEN].filter(
      (secret): secret is string => typeof secret === 'string' && secret !== '',
    );
    state.logger?.warn(
      selectionFailed(
        run === '' ? 'of run.ulid or PROBARA_RUN_ULID' : run,
        redact(messageOf(error), secrets),
      ),
    );
    return undefined;
  }
}

/** The name of a file without its extension: the title Cypress wrote in it. */
function baseNameOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\\/g, '/');
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}