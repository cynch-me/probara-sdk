/**
 * The script-tag build's replay loader: the engine's published replay script, of the very version
 * bundled here, from jsDelivr. A Content Security Policy must allow `https://cdn.jsdelivr.net` in
 * `script-src` for the replay; without it the script is refused and events go without a replay.
 */
import { VERSION as CAPTURE_VERSION, type CaptureReplayModule } from '@probara/vis-capture';

/** Where the replay script of the bundled engine is published. */
export const REPLAY_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/@probara/vis-capture@${CAPTURE_VERSION}/dist/vis-capture-replay.iife.js`;

/** The global the replay script sets. */
const GLOBAL = 'ProbaraVisCaptureReplay';

let loading: Promise<CaptureReplayModule> | undefined;

function loaded(): CaptureReplayModule | undefined {
  const module = (globalThis as Record<string, unknown>)[GLOBAL] as CaptureReplayModule | undefined;
  return typeof module?.createReplayRecorder === 'function' ? module : undefined;
}

/** Loads the replay script once; rejects when it cannot load or sets no recorder. */
export function loadReplayScript(): Promise<CaptureReplayModule> {
  loading ??= new Promise<CaptureReplayModule>((resolve, reject) => {
    const already = loaded();
    if (already !== undefined) {
      resolve(already);
      return;
    }
    const script = document.createElement('script');
    script.src = REPLAY_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.addEventListener('load', () => {
      const module = loaded();
      if (module === undefined) reject(new Error('the replay script set no recorder'));
      else resolve(module);
    });
    script.addEventListener('error', () => {
      reject(new Error('the replay script could not load'));
    });
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
