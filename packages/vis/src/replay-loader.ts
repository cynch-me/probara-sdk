/**
 * How in-app reporting loads the DOM replay recorder: lazily, once the widget keeps an instant
 * replay, so a page whose widget has it off never loads rrweb. The npm build imports the engine's
 * `@probara/vis-capture/replay` entry, which the site's bundler splits into its own chunk; the
 * script-tag build cannot split, so it loads the engine's published replay script instead
 * (`replay-script.ts`).
 */
import type * as Replay from '@probara/vis-capture/replay';

/** The engine's replay entry. */
export type ReplayModule = typeof Replay;

let load: () => Promise<ReplayModule> = () => import('@probara/vis-capture/replay');

/** Loads the replay recorder. */
export function loadReplayModule(): Promise<ReplayModule> {
  return load();
}

/** Replaces how the replay recorder is loaded: the script-tag build loads a script. */
export function setReplayLoader(loader: () => Promise<ReplayModule>): void {
  load = loader;
}
