/**
 * The script `vis record` injects into the recorded page: the capture engine's two script builds
 * (`@probara/vis-capture/iife`, the console, network, WebSocket and user event captures with their
 * redaction; `@probara/vis-capture/replay/iife`, the DOM replay recorder), wired to stream what
 * they capture to the CLI through a CDP binding. The builds are read from the installed
 * `@probara/vis-capture` package through its exports, never from another package's sources.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** The global the CLI reaches the injected recorder through: `flush()` and `stop()`. */
export const PAGE_HANDLE = "Symbol.for('probara.vis.cli')";

/** The most rrweb events one message carries: a full snapshot travels alone when it is large. */
const EVENTS_PER_MESSAGE = 200;
/** How often the page sends the replay events it gathered. */
const FLUSH_MS = 250;

/** The engine's two script builds, as `@probara/vis-capture` publishes them. */
export async function readEngineScripts(): Promise<{ capture: string; replay: string }> {
  const require = createRequire(import.meta.url);
  const read = async (specifier: string) =>
    // The source map comment would make DevTools fetch a map next to the recorded page.
    (await readFile(require.resolve(specifier), 'utf8')).replace(
      // Only the file's own last line: the bundle holds the same comment inside a worker's source string.
      /\n\/\/# sourceMappingURL=[^\n]*\s*$/,
      '',
    );
  const [capture, replay] = await Promise.all([
    read('@probara/vis-capture/iife'),
    read('@probara/vis-capture/replay/iife'),
  ]);
  return { capture, replay };
}

/**
 * The injected source. It runs in the top frame only, once per document, before the page's own
 * scripts when the document is new. It takes the binding off `window`, so the page's scripts cannot
 * call it (the CLI still treats every message as untrusted), and wraps the builds in a function so
 * their globals never reach the page.
 */
export function pageScript(binding: string, engine: { capture: string; replay: string }): string {
  return `(() => {
"use strict";
if (window.top !== window) return;
const handle = ${PAGE_HANDLE};
if (window[handle] !== undefined) return;
const send = window[${JSON.stringify(binding)}];
if (typeof send !== "function") return;
try { delete window[${JSON.stringify(binding)}]; } catch {}
let stopped = false;
const post = (message) => { if (stopped) return; try { send(JSON.stringify(message)); } catch {} };
${engine.capture}
${engine.replay}
const engine = ProbaraVisCapture;
const origin = performance.now();
const session = {
  get state() { return stopped ? "stopped" : "recording"; },
  start() {}, stop() {},
  stamp() { return { t: Math.max(0, Math.round(performance.now() - origin)), ts: Date.now() }; },
  record(stream, entry) { if (stopped) return false; post({ kind: stream, entry }); return true; },
  entries() { return []; }, dropped() { return 0; },
};
const captures = [];
const add = (create) => { try { const capture = create(); capture.start(); captures.push(capture); } catch {} };
add(() => engine.createConsoleCapture(session));
add(() => engine.createNetworkCapture(session, { ignoreUrls: [] }));
add(() => engine.createWebSocketCapture(session, { ignoreUrls: [] }));
let replay;
let blur;
let sent = 0;
const flush = () => {
  if (replay === undefined) return;
  const events = replay.events();
  while (sent < events.length) {
    const batch = events.slice(sent, sent + ${String(EVENTS_PER_MESSAGE)});
    sent += batch.length;
    post({ kind: "replay", events: batch });
  }
};
const begin = () => {
  if (stopped) return;
  try { blur = engine.createBlurController(); } catch { blur = undefined; }
  add(() => engine.createUserEventCapture(session, blur === undefined ? {} : { blur }));
  try {
    replay = ProbaraVisCaptureReplay.createReplayRecorder(blur === undefined ? { mode: "full" } : { mode: "full", blur });
    replay.start();
  } catch { replay = undefined; }
  engine.collectEnvironment().then((environment) => post({ kind: "environment", environment }), () => {});
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", begin, { once: true });
else begin();
const timer = setInterval(flush, ${String(FLUSH_MS)});
addEventListener("pagehide", flush);
const stop = () => {
  if (stopped) return;
  flush();
  clearInterval(timer);
  removeEventListener("pagehide", flush);
  for (const capture of captures.splice(0)) { try { capture.stop(); } catch {} }
  try { replay?.stop(); } catch {}
  try { blur?.stop(); } catch {}
  stopped = true;
};
Object.defineProperty(window, handle, { value: Object.freeze({ flush, stop }), configurable: false, enumerable: false });
})();`;
}
