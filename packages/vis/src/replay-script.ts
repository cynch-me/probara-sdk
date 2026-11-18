/**
 * The script-tag build's replay loader: the engine's published replay script, of the very
 * version bundled here, from jsDelivr. A Content Security Policy must allow
 * `https://cdn.jsdelivr.net` in `script-src` for the instant replay; without it the script is
 * refused, and the reporter offers recording only.
 */
import { VERSION as CAPTURE_VERSION } from '@probara/vis-capture';
import type { ReplayModule } from './replay-loader.js';

/** Where the replay script of the bundled engine is published. */
export const REPLAY_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/@probara/vis-capture@${CAPTURE_VERSION}/dist/vis-capture-replay.iife.js`;

/** The global the replay script sets. */
const GLOBAL = 'ProbaraVisCaptureReplay';

let loading: Promise<ReplayModule> | undefined;

/** Loads the replay script once; rejects when it cannot load or sets no recorder. */
export function loadReplayScript(): Promise<ReplayModule> {
  loading ??= new Promise<ReplayModule>((resolve, reject) => {
    const loaded = (): ReplayModule | undefined => {
      const module = (globalThis as Record<string, unknown>)[GLOBAL] as ReplayModule | undefined;
      return typeof module?.createReplayRecorder === 'function' ? module : undefined;
    };
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
