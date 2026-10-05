/**
 * The session two processes of a `cypress run` share, on disk.
 *
 * Cypress does NOT run the reporter and the plugin in one process: it builds the Mocha reporter in
 * the process that drives each spec (the same one for every spec of the run), and runs
 * `setupNodeEvents` in a **child** of it (verified in Cypress 16.1.1). Nor do they talk over the
 * channel Cypress forked the child with: the child can `process.send`, and the reporter process has
 * no channel at all (`process.channel` is undefined there), so a message sent to it goes nowhere.
 *
 * What they do share is a directory, whose name both processes derive without being told: the
 * reporter knows its own pid, and the plugin its parent's, which is the reporter's. Everything one
 * side writes there is picked up by the other at a moment that is safely later:
 *
 * - the plugin writes the browser, the screenshots and what the `probara.*` helpers said while the
 *   spec runs, and the reporter reads them when the spec ends;
 * - the reporter writes the results of a spec when it ends, and the plugin sends them at
 *   `after:spec`, with the video of the spec on the failed ones, and closes the run at `after:run`
 *   (the run is the plugin's: Cypress awaits `after:run`, and it is over before the reporter process
 *   is killed, ~50 ms later).
 *
 * Every file is written to a temporary name and renamed over its own, so a reader sees the whole
 * of one version or the other.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelLine, TestResultInput } from '@probara/core';
import type { BrowserLine } from './browser-message.js';

/** What the reporter writes for one spec, and the plugin sends. */
/** One result of a spec, and the test it is an attempt of. */
export interface SpecResult {
  /**
   * The same string for every attempt of one test: `Sending N results of M tests` counts the
   * attempts of a test as the one test they are of.
   */
  test: string;
  /** The result, as core takes it. */
  input: TestResultInput;
}

export interface SpecResults {
  /** The spec the results are of, relative to the project root. */
  spec: string;
  /** Every result of the spec, in the order the reporter built them. */
  results: readonly SpecResult[];
  /** How many results `probara.ignore()` left out, counted in the `Sending` line. */
  ignored: number;
  /**
   * What `runCasesOnly` left out of the report of this spec, for the one line the plugin logs at
   * `after:run`: `tests` distinct tests reported, `skipped` of them skipped by the support file and
   * left out of the report.
   */
  selection?: SpecSelectionCounts | undefined;
}

/** How many tests of a spec the run selection reported, and how many it left out. */
export interface SpecSelectionCounts {
  /** The ULID of the run whose cases took the tests. */
  run: string;
  /** Every distinct test the spec reported, attempts of a test counted as the one test. */
  tests: number;
  /** How many of them the support file skipped and the reporter left out of the report. */
  skipped: number;
}

/**
 * What the plugin wrote of the run selection of a spec, which the reporter reads when the spec ends:
 * the run whose cases took its tests, and the names (describes, then title) of the ones the support
 * file skipped and the report leaves out.
 */
export interface SpecSelection {
  run: string;
  deselected: string[][];
}

/** What the plugin writes of a spec when it ends. */
export interface SpecState {
  /** The video of the spec, or `null` when it has none. */
  video: string | null;
  /** How many tests failed, and how many ran (a spec Cypress could not parse has none). */
  failures: number;
  tests: number;
}

/** The marker the plugin writes when `setupNodeEvents` ran: the reporter reads it to know it is there. */
export interface PluginState {
  /** The version of the package that registered the plugin. */
  version: string;
  /** Epoch milliseconds, for a stale directory left by another run. */
  readyAt: number;
}

/**
 * The directory one run shares. `pid` is the pid of the reporter process: the reporter passes its
 * own, and the plugin its parent's (which is the reporter's).
 */
export function sessionDir(pid: number): string {
  return join(tmpdir(), 'probara-cypress-reporter', String(pid));
}

/** The file a spec's own state is in (`cypress/e2e/cart.cy.js` → `cypress_e2e_cart.cy.js`). */
function specFileName(spec: string): string {
  return `${encodeURIComponent(spec)}.json`;
}

/**
 * Writes `content` where `name` is, at once: a reader never sees half of it. A run that never
 * opened its directory writes nothing at all (an empty `dir` would land in the working directory of
 * whatever process called it).
 */
export function writeJson(dir: string, name: string, content: unknown): void {
  writeBytes(dir, name, JSON.stringify(content));
}

/**
 * Writes the bytes of a copy (an attached file, or the console output of a test) where `name` is,
 * at once: the reader that finds it sees a whole file, never half of one.
 */
export function writeBytes(dir: string, name: string, content: string | Uint8Array): void {
  if (dir === '') return;
  try {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    const target = join(dir, name);
    const temporary = `${target}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  } catch {
    // The session is a convenience: a file that cannot be written loses what it holds, never a run.
  }
}

function readFile(dir: string, name: string): unknown {
  if (dir === '') return undefined;
  try {
    return JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** The marker the plugin leaves, when it registered this run. */
export function readPluginState(dir: string): PluginState | undefined {
  return readFile(dir, PLUGIN_FILE) as PluginState | undefined;
}

/** The browser the run uses. */
export function readBrowser(dir: string): string | undefined {
  const file = readFile(dir, BROWSER_FILE) as { name?: string } | undefined;
  return file?.name;
}

/** What the `probara.*` helpers of the browser said, in the order they called. */
export function readLines(dir: string): SessionLine[] {
  return (readFile(dir, LINES_FILE) as SessionLine[] | undefined) ?? [];
}

/**
 * A line of the transport as the session holds it: what the browser sent (its identity, and no
 * attempt: the reporter resolves that one) or what another adapter wrote, which names its attempt.
 */
export type SessionLine = BrowserLine | ChannelLine;

/** The run selection of every spec of the run, as the plugin wrote it. */
export function readSelections(dir: string): Record<string, SpecSelection> {
  return (readFile(dir, SELECTION_FILE) as Record<string, SpecSelection> | undefined) ?? {};
}

/** The screenshots Cypress took of a spec, in the order it took them. */
export function readScreenshots(dir: string, spec: string): { path: string }[] {
  return (readFile(dir, screenshotsFile(spec)) as { path: string }[] | undefined) ?? [];
}

/** The results the reporter process handed over for a spec, when it reported any. */
export function readResults(dir: string, spec: string): SpecResults | undefined {
  return readFile(dir, resultsFile(spec)) as SpecResults | undefined;
}

/** The results the reporter wrote for a spec. */
export function resultsFile(spec: string): string {
  return join('results', specFileName(spec));
}

/** The state the plugin wrote of a spec when it ended. */
export function stateFile(spec: string): string {
  return join('specs', specFileName(spec));
}

/** The screenshots the plugin collected for a spec. */
export function screenshotsFile(spec: string): string {
  return join('screenshots', specFileName(spec));
}

/** What the plugin wrote when `setupNodeEvents` ran, in this session's directory. */
export const PLUGIN_FILE = 'plugin.json';
/** The browser the run uses. */
export const BROWSER_FILE = 'browser.json';
/** What the `probara.*` helpers of the browser said, one line per call. */
export const LINES_FILE = 'lines.json';
/** What the support file asked about the run selection, one entry per spec. */
export const SELECTION_FILE = 'selection.json';
/** The folder of the session that holds the copies of the files a test attached. */
export const FILES_FOLDER = 'files';

/** Where the copy of an attached file lives, as core's reader looks it up: `files/<uuid>`. */
export function copyFile(copy: string): string {
  return join(FILES_FOLDER, copy);
}

/**
 * Removes the directory of a finished run: the plugin does it at `after:run`, once everything of
 * the run is sent. A leftover of a run that died is removed by the next run that finds it, which
 * knows the directory is not its own (its pid is in its name).
 */
export function removeSession(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A leftover directory is never worth an error: it is one folder in the system's temporary
    // directory, and the next run of the same pid removes its own.
  }
}
