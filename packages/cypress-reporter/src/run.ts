/**
 * The run of a `cypress run`: the Probara run the reporter process's results go into, its counts,
 * and its closing. It lives here, in the `setupNodeEvents` process, because that is where Cypress
 * awaits the end of the run (`after:run`) and where the video of each spec arrives.
 *
 * The reporter process hands its results over on disk (`session-files.ts`); this module reads them
 * at `after:spec`, attaches the video of the spec to its failed results, and sends everything at
 * `after:run`, once.
 */
import {
  createAdapterSession,
  createReporter,
  type AdapterSession,
  type AttachmentInput,
  type ChannelLine,
  type Logger,
  type ProbaraReporter,
  type ReportSummary,
  type TestResultInput,
} from '@probara/core';
import {
  BROWSER_FILE,
  LINES_FILE,
  PLUGIN_FILE,
  readLines,
  readResults,
  readScreenshots,
  removeSession,
  resultsFile,
  screenshotsFile,
  sessionDir,
  stateFile,
  writeJson,
  type SpecState,
} from './session-files.js';
import type { Setup } from './options.js';
import { VERSION } from './version.js';

/** The failed result of a spec Cypress could not run at all (a syntax error). */
export const SPEC_FAILED_TO_RUN = 'Spec failed to run';

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
}

let state: RunState | undefined;

/**
 * Opens the run of a plugin: the directory it shares with the reporter process (whose pid is this
 * process' parent), core's reporter with the setup's options, and the marker the reporter looks for
 * to know it has a plugin. Returns `undefined` when reporting is off, which is not an error.
 */
export function openRun(setup: Setup, interactive: boolean): RunState | undefined {
  if (state !== undefined) return state;
  const dir = sessionDir(process.ppid);
  const logger = setup.core.logger ?? runLogger();
  try {
    // Cypress loads the config before it builds any reporter, so this marker is in place before
    // the reporter process asks whether it has a plugin.
    writeJson(dir, PLUGIN_FILE, { version: VERSION, readyAt: Date.now() });
  } catch {
    // Without the marker the reporter reports on its own, one run per spec, and says why.
  }
  if (logger === undefined) return undefined;
  const core = interactive ? { ...setup.core, closeRun: false, closeRuns: undefined } : setup.core;
  const reporter = createReporter(core);
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

/** `after:screenshot`: the file Cypress took for an attempt of the spec that is running. */
export function addScreenshot(spec: string, path: string): void {
  const current = state;
  if (current === undefined) return;
  const file = screenshotsFile(spec);
  writeJson(current.dir, file, [...readScreenshots(current.dir, spec), { path }]);
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
export function addLine(line: Record<string, unknown>): void {
  const current = state;
  if (current === undefined) return;
  writeJson(current.dir, LINES_FILE, [...readLines(current.dir), line as ChannelLine]);
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
  // Core logs the results file it writes instead of the line with the counts.
  if (current.reporter.enabled) {
    const line = current.adapter.summaryLine();
    if (line !== undefined) current.logger.info(line);
  }
  current.completing = current.reporter
    .complete()
    .then((summary) => {
      logRun(summary, current);
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
