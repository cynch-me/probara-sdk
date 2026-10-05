/**
 * The run of a `cypress run`: the Probara run the reporter process's results go into, its counts,
 * and its closing. It lives here, in the `setupNodeEvents` process, because that is where Cypress
 * awaits the end of the run (`after:run`) and where the video of each spec arrives.
 *
 * The reporter process hands its results over on disk (`session-files.ts`); this module reads them
 * at `after:spec`, attaches the video of the spec to its failed results, and sends everything at
 * `after:run`, once.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  createAdapterSession,
  createReporter,
  type AdapterSession,
  type AttachmentInput,
  type Logger,
  type ProbaraReporter,
  type ReportSummary,
  type TestResultInput,
} from '@probara/core';
import type { BrowserAttachment } from './browser-message.js';
import type { CypressScreenshotDetails } from './cypress.js';
import {
  BROWSER_FILE,
  LINES_FILE,
  PLUGIN_FILE,
  SELECTION_FILE,
  copyFile,
  copyInto,
  readLines,
  readResults,
  readScreenshots,
  readSelections,
  removeSession,
  resultsFile,
  screenshotsFile,
  sessionDir,
  startSession,
  stateFile,
  writeBytes,
  writeJson,
  type ScreenshotRecord,
  type SessionLine,
  type SpecSelection,
  type SpecState,
} from './session-files.js';
import type { Setup } from './options.js';
import { VERSION } from './version.js';

/** The failed result of a spec Cypress could not run at all (a syntax error). */
export const SPEC_FAILED_TO_RUN = 'Spec failed to run';

/** How long the end of a run waits for a stream that has not taken its bytes, at most. */
const FLUSH_TIMEOUT_MS = 100;

/** What the end of a run needs of the stream it logs on: what is pending of it, and when none is. */
export interface FlushableStream {
  /** The bytes written to the stream that are not in its reader yet; 0 once they all are. */
  readonly writableLength: number;
  once(event: 'drain', listener: () => void): unknown;
  off(event: 'drain', listener: () => void): unknown;
}

/**
 * Hands the lines of a run over before Cypress takes this process apart.
 *
 * The last line of a run is written microseconds before the run ends: the attachment totals core
 * logs when it completes the run. Cypress ends the plugin process soon after `after:run` answers,
 * and Node does not write to a pipe synchronously on every platform (macOS, Windows), so a line
 * still in this process' buffer would be lost with it. This waits until Node has nothing of ours
 * pending on stdout, where every `[probara]` line goes (`LOG_STREAM` in `options.ts`): a
 * `writableLength` of 0 means the bytes are in the pipe. Bounded, so a run ends whatever happens.
 */
export async function flushRunOutput(
  stream: FlushableStream = process.stdout,
  { timeoutMs = FLUSH_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<void> {
  if (stream.writableLength === 0) return;
  await new Promise<void>((resolve) => {
    const drained = (): void => {
      clearTimeout(timer);
      stream.off('drain', drained);
      resolve();
    };
    const timer = setTimeout(drained, Math.max(timeoutMs, 0));
    stream.once('drain', drained);
  });
}

/** How a video is attached to the failed results of its spec. */
function videoOf(video: string): AttachmentInput {
  return { path: video, contentType: 'video/mp4' };
}

/** The video of a spec on every result that failed, which is what `attachVideos` buys. */
function withVideo(input: TestResultInput, video: string | null): TestResultInput {
  if (video === null) return input;
  const failed = input.status === 'failed' || input.status === 'blocked';
  if (!failed) return input;
  return { ...input, attachments: [...(input.attachments ?? []), videoOf(video)] };
}

/** What this module knows of one run. */
interface RunState {
  dir: string;
  setup: Setup;
  logger: Logger;
  adapter: AdapterSession;
  reporter: ProbaraReporter;
  completing: Promise<ReportSummary | undefined> | undefined;
  /** The specs the reporter process built a reporter for, and the ones that ended without one. */
  specs: Set<string>;
  /** What the run selection reported of every spec: the counts the `Ran only the tests` line needs. */
  selection: { run: string; tests: number; skipped: number } | undefined;
  /** The warnings the plugin logged, once each. */
  warned: Set<string>;
}

let state: RunState | undefined;

/**
 * Opens the run of a plugin: the directory it shares with the reporter process (whose pid is this
 * process' parent), core's reporter with the setup's options, and the marker the reporter looks for
 * to know it has a plugin. Returns `undefined` when the run takes no result (reporting is off and
 * no results file is set), which is not an error: it then writes no marker, so the reporter process
 * never hands its results to a plugin that would not send them.
 */
export function openRun(setup: Setup, interactive: boolean): RunState | undefined {
  if (state !== undefined) return state;
  const dir = sessionDir(process.ppid);
  const logger = setup.core.logger;
  if (logger === undefined) return undefined;
  const core = interactive ? { ...setup.core, closeRun: false, closeRuns: undefined } : setup.core;
  const reporter = createReporter(core);
  // Cypress loads the config before it builds any reporter: the directory starts empty, and the
  // marker is in place, before the reporter process asks whether it has a plugin. Without it the
  // reporter reports on its own, one run per spec, and says why.
  startSession(dir);
  if (!reporter.acceptsResults) return undefined;
  writeJson(dir, PLUGIN_FILE, { version: VERSION, readyAt: Date.now() });
  state = {
    dir,
    setup,
    logger,
    adapter: createAdapterSession({
      logger,
      statusRules: setup.statusRules,
      projectCodes: setup.projectCodes,
    }),
    reporter,
    completing: undefined,
    specs: new Set(),
    selection: undefined,
    warned: new Set(),
  };
  return state;
}

/** Whether the run was opened (reporting is on and core took its options). */
export function hasRun(): boolean {
  return state !== undefined;
}

/** The logger of the run, for the warnings the plugin itself logs. */
export function runLogger(): Logger | undefined {
  return state?.logger;
}

/** `before:spec`: a spec begins; its screenshots are collected under its own name. */
export function beginSpec(spec: string): void {
  state?.specs.add(spec);
}

/**
 * `after:screenshot`: the file Cypress took for an attempt of the spec that is running, with the
 * attempt it was taken in (a file name Cypress cut short no longer says which one).
 */
export function addScreenshot(spec: string, details: CypressScreenshotDetails): void {
  const current = state;
  if (current === undefined) return;
  const { path, testFailure, testAttemptIndex } = details;
  const shot: ScreenshotRecord = {
    path,
    ...(typeof testFailure === 'boolean' ? { testFailure } : {}),
    ...(typeof testAttemptIndex === 'number' ? { testAttemptIndex } : {}),
  };
  writeJson(current.dir, screenshotsFile(spec), [...readScreenshots(current.dir, spec), shot]);
}

/**
 * `after:spec`: what the reporter process wrote of the spec is sent now, with the video on its
 * failed results. A spec that failed without any result of its own (Cypress could not parse it, so
 * it built no reporter) gets the one failed result that keeps it from showing green.
 */
export function endSpec(spec: string, video: string | null, failures: number): void {
  const current = state;
  if (current === undefined) return;
  const sent = readResults(current.dir, spec);
  if (sent === undefined) {
    if (failures > 0) {
      reportSpecFailure(current, spec, failures);
    }
    writeJson(current.dir, stateFile(spec), { video, failures, tests: 0 } satisfies SpecState);
    return;
  }
  // What the reporter process warned about: its own output never reaches the console of a
  // `cypress run`, so this is where the user sees it.
  for (const warning of sent.warnings ?? []) current.logger.warn(warning);
  countSelection(current, sent.selection);
  for (let index = 0; index < sent.ignored; index += 1) current.adapter.countIgnored();
  for (const { test, input } of sent.results) {
    const result = withVideo(input, current.setup.attachVideos ? video : null);
    current.adapter.count(result, test);
    current.reporter.addResult(result);
  }
  writeJson(current.dir, stateFile(spec), {
    video,
    failures,
    tests: sent.results.length,
  } satisfies SpecState);
}

/**
 * The one failed result of a spec that could not run at all: keyed with the spec and this title,
 * like every other result of the reporter.
 */
function reportSpecFailure(run: RunState, spec: string, failures: number): void {
  const input: TestResultInput = {
    identity: {
      ...(run.setup.keyIncludesFile ? { file: spec } : {}),
      titlePath: [SPEC_FAILED_TO_RUN],
    },
    status: 'failed',
    suitePath: run.setup.keyIncludesFile ? [spec] : [],
    startedAt: new Date(),
    notes: `Cypress could not run this spec: ${String(failures)} failure(s), no test ran`,
  };
  run.adapter.count(input, JSON.stringify([spec, SPEC_FAILED_TO_RUN]));
  run.reporter.addResult(input);
}

/**
 * The `probara` task: what a `probara.*` helper of the browser said, written where the reporter
 * reads it (before the spec ends).
 */
export function addLine(line: SessionLine): void {
  const current = state;
  if (current === undefined) return;
  writeJson(current.dir, LINES_FILE, [...readLines(current.dir), line]);
}

/**
 * The `probara` task of an attached file: the bytes are written into the session's `files/` folder
 * under a uuid, and the line names that copy, exactly as core's reader looks one up. A file the
 * test named by its `path` is read here, relative to `projectRoot` as Cypress reads one; a file
 * that cannot be read is left out with one warning per path, never an error into the test.
 */
export function addAttachment(attachment: BrowserAttachment, projectRoot: string): void {
  const current = state;
  if (current === undefined) return;
  const { line, text, base64, path } = attachment;
  const copy = randomUUID();
  if (typeof path === 'string' && typeof base64 !== 'string') {
    try {
      copyInto(current.dir, copyFile(copy), resolve(projectRoot, path));
    } catch (error) {
      const reason = (error as { code?: unknown }).code;
      const message = `probara.attach() could not read "${path}" (${typeof reason === 'string' ? reason : messageOf(error)}): it is not attached`;
      if (!current.warned.has(message)) current.logger.warn(message);
      current.warned.add(message);
      return;
    }
  } else {
    const content = typeof text === 'string' ? text : bytesOfBase64(base64 ?? '');
    if (content === undefined) return;
    writeBytes(current.dir, copyFile(copy), content);
  }
  addLine({
    ...line,
    copy,
    ...(typeof text === 'string' ? { body: 'text' } : { body: 'bytes' }),
  } as SessionLine);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The bytes of a base64 string, or `undefined` when it is not base64 at all. */
function bytesOfBase64(base64: string): Uint8Array | undefined {
  try {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch {
    // A payload a broken version of the support file sent: no line, and nothing into a test.
    return undefined;
  }
}

/**
 * The `probara` task of the run selection: what the support file skipped in `spec`, written where
 * the reporter reads it when the spec ends (it leaves exactly those results out of the report).
 */
export function addDeselected(spec: string, run: string, names: readonly string[]): void {
  const current = state;
  if (current === undefined) return;
  const all = readSelections(current.dir);
  const mine: SpecSelection = all[spec] ?? { run, deselected: [] };
  writeJson(current.dir, SELECTION_FILE, {
    ...all,
    [spec]: { run, deselected: [...mine.deselected, [...names]] },
  });
}

/** Whether the support file of this run asked about the run selection at all. */
export function askedSelection(): boolean {
  return state !== undefined && Object.keys(readSelections(state.dir)).length > 0;
}

/** What the run selection of a spec left out of the report, added to what the run counts. */
function countSelection(
  current: RunState,
  counts: { run: string; tests: number; skipped: number } | undefined,
): void {
  if (counts === undefined) return;
  const totals = current.selection ?? { run: counts.run, tests: 0, skipped: 0 };
  current.selection = {
    run: counts.run,
    tests: totals.tests + counts.tests,
    skipped: totals.skipped + counts.skipped,
  };
}

/**
 * One line of `runCasesOnly`, in the Jest reporter's wording: how many tests of the run's cases
 * matched, and how many the support file skipped and the report left out. Before the counts core
 * sends, at `after:run`.
 */
export function logSelection(): void {
  const current = state;
  const totals = current?.selection;
  if (current === undefined || totals === undefined || totals.tests === 0) return;
  const { run, tests, skipped } = totals;
  const ran = tests - skipped;
  if (ran === 0) {
    current.logger.warn(
      `No test matches the cases of the run ${run}: every test was skipped, and none is reported`,
    );
    return;
  }
  current.logger.info(
    `Ran only the tests of run ${run}: ${String(ran)} of ${String(tests)} tests match its cases; ${String(skipped)} skipped and not reported`,
  );
}

/** The browser the run uses, for the reporter's results: it adds it as a parameter of each. */
export function setBrowser(name: string | undefined): void {
  if (state === undefined) return;
  writeJson(state.dir, BROWSER_FILE, { name });
}

/**
 * `after:run`: every result the run has is sent, and the run it created is closed. Cypress awaits
 * this, so nothing is left to a process that is about to be killed.
 */
export function completeRun(): Promise<ReportSummary | undefined> {
  const current = state;
  if (current === undefined) return Promise.resolve(undefined);
  if (current.completing !== undefined) return current.completing;
  logSelection();
  // Core logs the results file it writes instead of the line with the counts.
  if (current.reporter.enabled) {
    const line = current.adapter.summaryLine();
    if (line !== undefined) current.logger.info(line);
  }
  current.completing = current.reporter
    .complete()
    .then(async (summary) => {
      logRun(summary, current);
      // Every line of the run is written by now, its last one (`Attached … files to results`) a
      // moment ago, and Cypress ends this process the moment this answers.
      await flushRunOutput();
      return summary;
    })
    .catch(() => undefined);
  return current.completing;
}

/** Names the run of an interactive session once: it stays open, and this is how to close it. */
function logRun(summary: ReportSummary | undefined, run: RunState): void {
  if (summary === undefined) return;
  for (const project of summary.projects) {
    const { ulid, displayId, state: runState } = project.run ?? {};
    if (ulid === undefined || displayId === undefined) continue;
    if (runState === 'closed') continue;
    run.logger.info(
      `The run ${displayId} of ${project.projectId} stays open: close it in Probara, or with probara run close --project ${project.projectId} --run-ulid ${ulid}`,
    );
  }
}

/** Removes the directory of a finished run: what is left of it belongs to nobody. */
export function closeRun(): void {
  if (state === undefined) return;
  removeSession(state.dir);
  state = undefined;
}

/** Forgets everything of a run: what a test of this module starts from. */
export function resetRun(): void {
  state = undefined;
}

/** The names the two processes agree on, exported for the reporter's own directory. */
export { resultsFile, screenshotsFile, stateFile };
