/**
 * The script-tag build of `@probara/browser`: the same API on the global `Probara`. When the loader
 * of the README ran before it, the calls it queued are made once this loads, `init` first, and the
 * uncaught errors and unhandled rejections it held are sent as unhandled. This build cannot split
 * its code, so the replay loads the engine's published replay script.
 */
import * as Probara from './index.js';
import { setReplayLoader } from './replay-loader.js';
import { loadReplayScript } from './replay-script.js';

export * from './index.js';

type Queued = readonly [method: string, args: readonly unknown[]];

const QUEUEABLE = new Set([
  'init',
  'captureException',
  'captureMessage',
  'captureEvent',
  'addBreadcrumb',
  'setUser',
  'setTag',
  'setTags',
  'setContext',
  'setExtra',
]);

function isQueued(value: unknown): value is Queued {
  return Array.isArray(value) && typeof value[0] === 'string' && Array.isArray(value[1]);
}

function replay([method, args]: Queued): void {
  if (method === 'error' || method === 'unhandledrejection') {
    const type = method === 'error' ? 'onerror' : 'onunhandledrejection';
    Probara.captureException(args[0], { mechanism: { type, handled: false } });
    return;
  }
  if (!QUEUEABLE.has(method)) return;
  const call = (Probara as unknown as Record<string, (...given: readonly unknown[]) => unknown>)[
    method
  ];
  call?.(...args);
}

/** Makes the calls the loader queued, `init` first; then `Probara` is this build. */
function takeOver(): void {
  const page = globalThis as { Probara?: unknown };
  const held = (page.Probara as { _q?: unknown } | undefined)?._q;
  page.Probara = Probara;
  if (!Array.isArray(held)) return;
  const queue = held.filter(isQueued);
  const init = queue.findLast(([method]) => method === 'init');
  if (init !== undefined) replay(init);
  for (const call of queue) {
    if (call[0] === 'init') continue;
    try {
      replay(call);
    } catch {
      // A queued call never stops the others.
    }
  }
}

try {
  setReplayLoader(loadReplayScript);
  takeOver();
} catch {
  // Never break the page that loads it.
}
