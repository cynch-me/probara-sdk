/**
 * The messages that join the two entry points of a Cypress run.
 *
 * Cypress does NOT run them in one process: the reporter is built in the process that drives Mocha
 * for each spec, and `setupNodeEvents` runs in a **child** process of that one (verified in Cypress
 * 16.1.1: the plugin process' `process.ppid` is the reporter process' `process.pid`, and the same
 * reporter process serves every spec of the run). Module state therefore joins the specs of a run,
 * but never the plugin with the reporter.
 *
 * The channel that joins the two already exists: Cypress forks the plugin, so the plugin can
 * `process.send` to the reporter, and the reporter listens with `process.on('message')`. Only the
 * plugin sends: what the reporter produces goes to Probara itself, from its own process.
 *
 * A message that is not ours is left alone (the channel carries Cypress's own), and a process with
 * no channel (a test, or a Cypress that runs the plugin in the reporter's process) never receives
 * one: the reporter then reports on its own, one run per spec, and says so.
 */
import type { CypressBeforeRun, CypressScreenshotDetails, CypressSpecResults } from './cypress.js';
import type { RunSelection } from '@probara/core';

/** The tag every message of this package carries, among the ones the channel already carries. */
export const PROBARA_MESSAGE = '@probara/cypress-reporter';

/** What the plugin process sends the reporter process. */
export type PluginMessage =
  /** `before:run`: the browser the run uses, as a parameter of every result. */
  | { type: typeof PROBARA_MESSAGE; kind: 'browser'; browser: string | undefined }
  /** `after:screenshot`: the file Cypress took for an attempt of a spec. */
  | { type: typeof PROBARA_MESSAGE; kind: 'screenshot'; spec: string; path: string }
  /**
   * `after:spec`: the video of the spec, and whether it failed. A spec Cypress could not run builds
   * no reporter at all, and this is where the reporter learns of it.
   */
  | {
      type: typeof PROBARA_MESSAGE;
      kind: 'spec';
      spec: string;
      video: string | null;
      failures: number;
    }
  /** The `probara` task: what a `probara.*` helper said, to be stamped with the running attempt. */
  | { type: typeof PROBARA_MESSAGE; kind: 'line'; line: Record<string, unknown> }
  /** `after:run`: the run is over; the reporter completes it and closes what it created. */
  | { type: typeof PROBARA_MESSAGE; kind: 'run-end' };

/** What the browser side of a run needs (`Cypress.expose('probara')`). */
export interface ProbaraExpose {
  version: string;
  captureOutput: boolean;
  selection?: RunSelection;
}

/** Whether `message` is one of ours: the only shape the reporter answers. */
export function isPluginMessage(message: unknown): message is PluginMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === PROBARA_MESSAGE &&
    typeof (message as { kind?: unknown }).kind === 'string'
  );
}

/** What the plugin sends. A process with no channel (a test) sends nothing, and says so once. */
export function send(message: PluginMessage): boolean {
  try {
    if (typeof process.send !== 'function') return false;
    process.send(message);
    return true;
  } catch {
    // A closed channel is a run that reports on its own, never an error into Cypress.
    return false;
  }
}

/** The listener the reporter process registers, and the messages it answers. */
export type PluginMessageHandler = (message: PluginMessage) => void;

/** The one listener: `process.on('message')` keeps the last of them otherwise. */
let listening: ((message: unknown) => void) | undefined;

/**
 * Answers the messages of `handle` in this process, once: a reporter process may load this module
 * again (Cypress resolves the reporter per spec), and one listener serves the whole run.
 */
export function listen(handle: PluginMessageHandler): void {
  if (listening !== undefined) return;
  listening = (message: unknown) => {
    if (!isPluginMessage(message)) return;
    try {
      handle(message);
    } catch {
      // A message must never break the run: it is lost, and the next one is answered.
    }
  };
  process.on('message', listening);
}

/** Stops answering messages: what a test does between two runs of this module's own process. */
export function stopListening(): void {
  if (listening === undefined) return;
  process.removeListener('message', listening);
  listening = undefined;
}

/** The fields of the Cypress events the plugin turns into messages, named once. */
export function browserOf(details: CypressBeforeRun): string | undefined {
  return details.browser?.name;
}

/** The path of a screenshot, or `undefined` for an event without one. */
export function screenshotOf(details: CypressScreenshotDetails): string {
  return details.path;
}

/** The video of a spec, and how many tests it failed, for the `spec` message. */
export function specOf(
  spec: string,
  results: CypressSpecResults,
): { video: string | null; failures: number } {
  return {
    video: typeof results.video === 'string' && results.video !== '' ? results.video : null,
    failures: results.stats?.failures ?? 0,
  };
}
