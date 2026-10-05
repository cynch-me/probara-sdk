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
 * of one version or the other. The one exception is what the helpers said ({@link LINES_FILE}): a
 * run can call them thousands of times, so each call appends one line to it, and the reader takes
 * only what was appended since its last read, and only lines whose end is written.
 */
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
   * What the reporter process warned about, once each: Cypress keeps that process' output to
   * itself, so the plugin logs these lines where the run's output is.
   */
  warnings?: readonly string[] | undefined;
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
  /**
   * Epoch milliseconds: the reporter takes only a marker written after its own process started,
   * never one a crashed run of the same pid left.
   */
  readyAt: number;
}

/**
 * The directory one run shares. `pid` is the pid of the reporter process: the reporter passes its
 * own, and the plugin its parent's (which is the reporter's).
 */
export function sessionDir(pid: number): string {
  return join(tmpdir(), 'probara-cypress-reporter', String(pid));
}

/**
 * Creates the directory of a run if it is not there: readable by the user that runs Cypress only
 * (it holds what the tests attached), in a parent every user of the machine can create theirs in.
 */
export function ensureSessionDir(dir: string): void {
  mkdirSync(dirname(dir), { recursive: true });
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
  }
}

/**
 * Starts the directory of a run from nothing: what a run that died before its `after:run` left
 * under the same pid (its marker, its results) would otherwise be read as this run's. The plugin
 * does it when `setupNodeEvents` runs, before the reporter process opens the directory.
 */
export function startSession(dir: string): void {
  removeSession(dir);
  try {
    ensureSessionDir(dir);
  } catch {
    // The session is a convenience: without it the reporter reports as if it had no plugin.
  }
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
    ensureSessionDir(dir);
    mkdirSync(join(dir, name, '..'), { recursive: true });
    const target = join(dir, name);
    const temporary = `${target}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  } catch {
    // The session is a convenience: a file that cannot be written loses what it holds, never a run.
  }
}

/**
 * Copies the file at `source` where `name` is, at once, like {@link writeBytes}. Unlike it, a
 * failure is the caller's to report (a file a test attached that is missing): it throws.
 */
export function copyInto(dir: string, name: string, source: string): void {
  if (dir === '') return;
  ensureSessionDir(dir);
  mkdirSync(join(dir, name, '..'), { recursive: true });
  const target = join(dir, name);
  const temporary = `${target}.${String(process.pid)}.tmp`;
  copyFileSync(source, temporary);
  renameSync(temporary, target);
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

/**
 * Appends what a `probara.*` helper said to the run's lines, as one JSON line written at once: the
 * task that called it returns after the write, so the reporter reads it when the attempt ends. A
 * line that cannot be written is lost, never a run.
 */
export function appendLine(dir: string, line: SessionLine): void {
  if (dir === '') return;
  try {
    ensureSessionDir(dir);
    appendFileSync(join(dir, LINES_FILE), `${JSON.stringify(line)}\n`);
  } catch {
    // The session is a convenience: a line that cannot be written loses what it holds, never a run.
  }
}

/** What the `probara.*` helpers of the browser said, read as the plugin appends it. */
export interface LinesReader {
  /**
   * Every line of the run so far, in the order the helpers called: the ones read before, then the
   * ones whose end was appended since. A line still being written waits for the next read.
   */
  read(): readonly SessionLine[];
}

/**
 * Opens the lines of a run for reading. Each read takes only the bytes appended since the last
 * one, so a run that calls the helpers thousands of times reads each line once. A file that is
 * gone, or another one than it read before (the session restarted), is read from the start.
 */
export function openLines(dir: string): LinesReader {
  let lines: SessionLine[] = [];
  let offset = 0;
  let identity: number | undefined;
  /** The bytes of a line whose end is not written yet: they may cut a character in two. */
  let partial: Buffer = Buffer.alloc(0);
  const restart = (): void => {
    lines = [];
    offset = 0;
    identity = undefined;
    partial = Buffer.alloc(0);
  };
  return {
    read() {
      if (dir === '') return lines;
      let descriptor: number;
      try {
        descriptor = openSync(join(dir, LINES_FILE), 'r');
      } catch {
        restart();
        return lines;
      }
      try {
        const { size, ino } = fstatSync(descriptor);
        if ((identity !== undefined && ino !== identity) || size < offset) restart();
        identity = ino;
        if (size === offset) return lines;
        const fresh = Buffer.alloc(size - offset);
        let filled = 0;
        while (filled < fresh.length) {
          const read = readSync(descriptor, fresh, filled, fresh.length - filled, offset + filled);
          if (read === 0) break;
          filled += read;
        }
        offset += filled;
        const pending = Buffer.concat([partial, fresh.subarray(0, filled)]);
        const end = pending.lastIndexOf(0x0a);
        partial = Buffer.from(pending.subarray(end + 1));
        if (end < 0) return lines;
        for (const text of pending.subarray(0, end).toString('utf8').split('\n')) {
          if (text === '') continue;
          try {
            lines.push(JSON.parse(text) as SessionLine);
          } catch {
            // A line no version of the plugin writes: left out, the others are still read.
          }
        }
        return lines;
      } catch {
        return lines;
      } finally {
        closeSync(descriptor);
      }
    },
  };
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

/** A screenshot Cypress took, as `after:screenshot` described it. */
export interface ScreenshotRecord {
  path: string;
  /** Whether Cypress took it because the attempt failed. */
  testFailure?: boolean | undefined;
  /** The attempt it was taken in, from 0. */
  testAttemptIndex?: number | undefined;
}

/** The screenshots Cypress took of a spec, in the order it took them. */
export function readScreenshots(dir: string, spec: string): ScreenshotRecord[] {
  return (readFile(dir, screenshotsFile(spec)) as ScreenshotRecord[] | undefined) ?? [];
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
/** What the `probara.*` helpers of the browser said, one JSON line per call, appended. */
export const LINES_FILE = 'lines.jsonl';
/** What the support file asked about the run selection, one entry per spec. */
export const SELECTION_FILE = 'selection.json';
/** The folder of the session that holds the copies of the files a test attached. */
export const FILES_FOLDER = 'files';

/** Where the copy of an attached file lives, as core's reader looks it up: `files/<uuid>`. */
export function copyFile(copy: string): string {
  return join(FILES_FOLDER, copy);
}

/**
 * Removes the directory of a run: the plugin does it at `after:run`, once everything of the run is
 * sent, and when it starts one ({@link startSession}). The leftover of a run that died stays until
 * a run of the same pid starts, or the system clears its temporary directory.
 */
export function removeSession(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A leftover directory is never worth an error: it is one folder in the system's temporary
    // directory.
  }
}
