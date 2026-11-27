/**
 * How the SDK loads the DOM replay recorder: lazily, only once the replay is on, so a page without
 * it never loads rrweb. The npm build imports the engine's `@probara/vis-capture/replay` entry,
 * which the app's bundler splits into its own chunk; the script-tag build cannot split, so it loads
 * the engine's published replay script instead (`replay-script.ts`).
 */
import type { CaptureReplayModule } from '@probara/vis-capture';

let load: () => Promise<CaptureReplayModule> = () => import('@probara/vis-capture/replay');

/** Loads the replay recorder. */
export function loadReplayModule(): Promise<CaptureReplayModule> {
  return load();
}

/** Replaces how the replay recorder is loaded: the script-tag build loads a script. */
export function setReplayLoader(loader: () => Promise<CaptureReplayModule>): void {
  load = loader;
}
