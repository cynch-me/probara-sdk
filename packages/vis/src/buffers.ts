/**
 * The pre-click buffers of in-app reporting, the "instant replay": a rolling DOM replay and the
 * console, network and user events of the last minutes, held in memory only and sent only when
 * the reporter sends them. Bounded by time and size; the replay pauses for a while on a page that
 * costs it too much. The site's blur applies without changing how the page looks (the replay
 * blocks it, user events skip its text), and its sanitizers apply to everything kept.
 */
import {
  SHARED_CAPTURE_LIMITS,
  SHARED_CAPTURE_WINDOW_MS,
  attachSharedCapture,
  type ConsoleEntry,
  type NetworkEntry,
  type Sanitizers,
  type SharedCapture,
  type StreamEntries,
  type UrlPattern,
  type WebSocketMessageEntry,
} from '@probara/vis-capture';
import type { ReplayEvent } from '@probara/vis-capture/replay';
import { sanitizersOf } from './recorder.js';
import type { ReplayModule } from './replay-loader.js';

/** How far back the console, network and user events of an instant replay go. */
export const INSTANT_REPLAY_WINDOW_MS = SHARED_CAPTURE_WINDOW_MS;

/** What each diagnostics stream of an instant replay holds at most, besides its time window. */
export const INSTANT_REPLAY_LIMITS = SHARED_CAPTURE_LIMITS;

/** What just happened, copied out of the buffers when the reporter opens its review. */
export interface Frozen {
  events: ReplayEvent[];
  console: readonly ConsoleEntry[];
  network: readonly (NetworkEntry | WebSocketMessageEntry)[];
  userEvents: readonly StreamEntries['events'][];
  /** Epoch milliseconds of the copy. */
  at: number;
}

export interface PreClickBuffers {
  /** Buffering, with a replay that can be played. */
  readonly available: boolean;
  /** A copy of what is held so far, buffering on; `null` when nothing can be sent. */
  snapshot(): Frozen | null;
  /**
   * Stops buffering and hands over what was held; `null` when nothing can be sent. Another
   * Probara SDK on the page keeps the shared capture running.
   */
  freeze(): Frozen | null;
  /** Starts buffering again, from what happens next. */
  restart(): void;
  /**
   * Stops buffering; the page's fetch, XHR, console and WebSocket are put back unless another
   * Probara SDK on the page still captures.
   */
  stop(): void;
}

export interface PreClickBufferOptions extends Sanitizers {
  replay: ReplayModule;
  /** The site's blur selectors, on top of the automatic ones. */
  blur: readonly string[];
  ignoreUrls: readonly UrlPattern[];
  /** Elements whose events are not recorded: the panel and the launcher. */
  ignore: (element: Element) => boolean;
}

/** Whether this browser can keep an instant replay. */
export function isInstantReplaySupported(): boolean {
  try {
    return (
      typeof MutationObserver === 'function' &&
      typeof CompressionStream === 'function' &&
      typeof Element.prototype.attachShadow === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Starts buffering at once, through the page's shared capture: beside another Probara SDK that
 * started it, the console, network, user events and replay are recorded once for both. Never
 * throws.
 */
export function startPreClickBuffers(options: PreClickBufferOptions): PreClickBuffers {
  const { replay: module, blur: selectors, ignoreUrls, ignore, ...rest } = options;
  let capture: SharedCapture | undefined;

  function begin(): SharedCapture | undefined {
    try {
      capture = attachSharedCapture({
        ...sanitizersOf(rest),
        ignoreUrls,
        ignore,
        blur: selectors,
        replay: module,
      });
    } catch {
      halt();
    }
    return capture;
  }

  function halt(): void {
    capture?.release();
    capture = undefined;
  }

  function snapshot(): Frozen | null {
    const held = capture?.snapshot() ?? null;
    return held === null ? null : { ...held, events: held.events as unknown as ReplayEvent[] };
  }

  begin();
  return {
    get available() {
      return capture?.available === true;
    },
    snapshot,
    freeze() {
      const frozen = snapshot();
      halt();
      return frozen;
    },
    restart() {
      if (capture !== undefined) {
        capture.restart();
        return;
      }
      const attached = begin();
      // Attached to a capture another SDK kept running: what it held was handed over already.
      if (attached?.owner === false) attached.restart();
    },
    stop() {
      halt();
    },
  };
}
