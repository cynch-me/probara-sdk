/**
 * What the reporter process keeps for one `cypress run`, and what it hands to the plugin process
 * that sends them.
 *
 * Cypress builds one Mocha reporter per spec, in the same process for every spec of a run, so this
 * module's state is that of the whole run: the options it resolved once, what the `probara.*`
 * helpers of the browser said about each attempt, the screenshots Cypress took, and the results of
 * each spec, written where the plugin reads them (see `session-files.ts`).
 *
 * The run itself belongs to the plugin: it is created, completed and closed where Cypress awaits
 * it. A run whose Cypress config registers no plugin has nobody to hand its results to, and this
 * process is killed ~50 ms after the last spec (Cypress ends it with an explicit `process.exit`,
 * which no `beforeExit` hook sees), so that run sends them itself, one spec at a time.
 */
import {
  createAdapterSession,
  detailsOf,
  logAdapterError,
  redact,
  type AttemptDetails,
  type ChannelLine,
  type Logger,
} from '@probara/core';
import { mkdirSync } from 'node:fs';
import { LOG_STREAM, resolveSetup, type Setup } from './options.js';
import { reporterOptionsOf } from './reporter-options.js';
import {
  readBrowser,
  readLines,
  readPluginState,
  readResults,
  readScreenshots,
  readSelections,
  removeSession,
  writeJson,
  resultsFile,
  sessionDir,
  type SessionLine,
  type SpecResults,
  type SpecSelection,
} from './session-files.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A screenshot Cypress took for one attempt of one test. */
export interface SpecScreenshot {
  /** The file, as the plugin's `after:screenshot` named it. */
  path: string;
  /** Its name without the extension: the titles of the test, joined the way Cypress joins them. */
  name: string;
}

/** What the reporter of a spec can be asked. */
export interface SpecReporter {
  /** The spec it reports, relative to the project root. */
  readonly spec: string;
  /** How many results of the spec were handed over. */
  readonly sent: number;
}

/**
 * The setup of the run, resolved once from the options Cypress hands the reporter, with `rootDir`
 * the directory spec files are reported relative to (the working directory, which is the project
 * root). The plugin resolves the same options in its own process, for its own work.
 */
let setup: Setup | undefined;
let unusable = false;
let options_: unknown;
let logger: Logger | undefined;
/** The warnings of the run, once each: the reporter process holds them, the plugin sends the results. */
let adapter = createAdapterSession();
/** The browser `before:run` announced, read back when a spec's results are built. */
let browser: string | undefined;
/**
 * The warnings of the run, in the order they were first said: this process' own logger writes them
 * (a test of this package reads them there), but the console of a `cypress run` never shows what
 * the reporter process says — Cypress keeps its output to itself — so they are handed to the plugin
 * with the results of a spec, and logged where the run's output is.
 */
let handoverWarnings: string[] = [];

/** Where this run's two processes meet. */
let dir = '';

export const session = {
  /**
   * The setup of the run, resolved once from the options Cypress hands the reporter. `rootDir` is
   * the directory spec files are reported relative to.
   */
  begin(options: unknown, rootDir: string): Setup | undefined {
    if (setup !== undefined || unusable) return setup;
    options_ = options;
    try {
      const given = reporterOptionsOf(options);
      if (typeof given !== 'object' || given === null) {
        unusable = true;
        return undefined;
      }
      setup = resolveSetup(given, rootDir);
      logger = setup.core.logger;
      adapter = createAdapterSession({
        logger,
        statusRules: setup.statusRules,
        projectCodes: setup.projectCodes,
      });
      for (const warning of setup.warnings) logger?.warn(warning);
      return setup;
    } catch (error) {
      // A reporter must never break the test run: nothing is reported, and the log says why.
      unusable = true;
      session.logError(
        `Probara reporting is off: the reporter could not start: ${messageOf(error)}`,
      );
      return undefined;
    }
  },

  /** The resolved setup of the run, when there is one. */
  resolved(): Setup | undefined {
    return setup;
  },

  /** A warning the first time, then at debug: the same problem tends to repeat in every test. */
  warnOnce(message: string, where: string): void {
    const first = !warnedOnce.has(message);
    warnedOnce.add(message);
    adapter.warnOnce(message, where);
    if (first) handoverWarnings.push(`${message} (first seen in ${where})`);
  },

  /**
   * The warnings said so far, which the plugin process logs with the run: everything this process
   * warned about, each one once, wherever it came from.
   */
  takeWarnings(): string[] {
    const taken = handoverWarnings;
    handoverWarnings = [];
    return taken;
  },

  /** The browser the run uses (`electron`), sent as a parameter of every result. */
  browser(): string | undefined {
    return readBrowser(dir);
  },

  /** Options Cypress handed the reporter, to redact a message with. */
  options(): unknown {
    return options_;
  },

  /** Where the reporter writes, once its setup is resolved. */
  logger(): Logger | undefined {
    return logger;
  },

  /** One error line on stdout, without the token, even before the setup is known. */
  logError(message: string): void {
    logAdapterError(message, options_, logger, LOG_STREAM);
  },

  /** The directory the run shares with its plugin. */
  dir(): string {
    return dir;
  },

  /**
   * Opens the run: the directory this process and its plugin meet in, and what the plugin left in
   * it before this process loaded the reporter (its marker).
   */
  open(): { plugin: boolean; setup: Setup | undefined } {
    if (dir !== '') return { plugin: session.plugin(), setup };
    dir = sessionDir(process.pid);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // The session is a convenience: without it the run reports as if it had no plugin.
    }
    return { plugin: session.plugin(), setup };
  },

  /**
   * Whether `probaraNodeEvents` registered this run: the plugin writes its marker before the
   * reporter is ever built (Cypress loads the config first), so a missing marker is a config with
   * no plugin.
   */
  plugin(): boolean {
    return dir !== '' && readPluginState(dir) !== undefined;
  },

  /** Closes the run: the directory of a run that is over goes with it. */
  close(): void {
    if (dir === '') return;
    removeSession(dir);
  },

  /** What the plugin knows of the run so far: the browser (from `before:run`) and what the
   * `probara.*` helpers said, one line per call. The reporter reads them when a spec ends, which
   * is after every call of that spec.
   */
  pluginState(): { browser: string | undefined; lines: readonly SessionLine[] } {
    browser = readBrowser(dir);
    return { browser, lines: readLines(dir) };
  },

  /** How many lines the transport holds: where the window of an attempt opens and ends. */
  lineCount(): number {
    return readLines(dir).length;
  },

  /**
   * What the run selection (`runCasesOnly`) skipped in a spec: the run whose cases took its tests,
   * and the names of the ones the report leaves out. `undefined` without a selection, or when the
   * support file skipped none: every test of the spec is then reported.
   */
  selectionOf(spec: string): SpecSelection | undefined {
    return readSelections(dir)[spec];
  },

  /** The screenshots Cypress took of a spec, named the way it names them. */
  screenshotsOf(spec: string): readonly SpecScreenshot[] {
    return readScreenshots(dir, spec).map((shot) => ({
      path: shot.path,
      name: baseNameOf(shot.path),
    }));
  },

  /**
   * What the helpers said, read into the parts of a result. `dir` is the session directory: the
   * plugin wrote the copies of the attached files there, and core's reader looks them up in it.
   */
  detailsOf(lines: readonly SessionLine[]): AttemptDetails {
    // The browser names no attempt in its lines: the reporter resolved the attempt each of them
    // belongs to (and left out the ones it resolved none for) before it got here, and core's reader
    // reads what a line holds, never which attempt wrote it.
    return detailsOf(lines as ChannelLine[], dir);
  },

  /** Records the reporter that is running a spec, so what it holds can be asked for. */
  setSpecReporter(reporter: SpecReporter): void {
    specReporters.set(reporter.spec, reporter);
  },

  /** The reporter that ran a spec, when one did. */
  specReporter(spec: string): SpecReporter | undefined {
    return specReporters.get(spec);
  },

  /**
   * Hands the results of a spec over to the plugin process, which sends them with the run it owns.
   * Nothing waits for them here: the plugin reads them at `after:spec`, long after this call.
   */
  handOver(results: SpecResults): void {
    if (dir === '') return;
    writeJson(dir, resultsFile(results.spec), results);
  },

  /** What the plugin left of a spec that never reported: nothing at all. */
  hasResults(spec: string): boolean {
    return readResults(dir, spec) !== undefined;
  },

  /**
   * Forgets everything of a run, its directory included: a run's session belongs to that run, and
   * a pid can be taken again.
   */
  reset(): void {
    session.close();
    setup = undefined;
    unusable = false;
    options_ = undefined;
    logger = undefined;
    adapter = createAdapterSession();
    browser = undefined;
    dir = '';
    handoverWarnings = [];
    warnedOnce.clear();
    specReporters.clear();
  },
};

const specReporters = new Map<string, SpecReporter>();
/** The warnings already handed over, once each: the same problem repeats in every test. */
const warnedOnce = new Set<string>();

/** The name of a file without its extension: the title Cypress wrote in it. */
function baseNameOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\\/g, '/');
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

/** Redacts a message with the token of the options, for the plugin process's own errors. */
export function redactWith(setup: Setup, message: string): string {
  const { apiToken, env } = setup.core;
  const secrets = [apiToken, (env ?? process.env).PROBARA_API_TOKEN].filter(
    (secret): secret is string => typeof secret === 'string' && secret !== '',
  );
  return redact(message, secrets);
}
