/**
 * The pre-click buffers of in-app reporting, the "instant replay": a rolling DOM replay and the
 * console, network and user events of the last minutes, held in memory only and sent only when
 * the reporter sends them. Bounded by time and size; the replay pauses for a while on a page that
 * costs it too much. The site's blur applies without changing how the page looks (the replay
 * blocks it, user events skip its text), and its sanitizers apply to everything kept.
 */
import {
  createBlurController,
  createRecordingSession,
  type ConsoleEntry,
  type NetworkEntry,
  type RecordingSession,
  type Sanitizers,
  type StreamEntries,
  type UrlPattern,
  type WebSocketMessageEntry,
} from '@probara/vis-capture';
import type { ReplayEvent, ReplayRecorder } from '@probara/vis-capture/replay';
import { applyAutoBlur } from './blur.js';
import { startPageCaptures } from './captures.js';
import { sanitizersOf } from './recorder.js';
import type { ReplayModule } from './replay-loader.js';

/** How far back the console, network and user events of an instant replay go. */
export const INSTANT_REPLAY_WINDOW_MS = 5 * 60_000;

/** What each diagnostics stream of an instant replay holds at most, besides its time window. */
export const INSTANT_REPLAY_LIMITS = Object.freeze({
  console: Object.freeze({
    maxEntries: 1000,
    maxBytes: 1024 * 1024,
    maxAgeMs: INSTANT_REPLAY_WINDOW_MS,
  }),
  network: Object.freeze({
    maxEntries: 1000,
    maxBytes: 8 * 1024 * 1024,
    maxAgeMs: INSTANT_REPLAY_WINDOW_MS,
  }),
  events: Object.freeze({
    maxEntries: 2000,
    maxBytes: 1024 * 1024,
    maxAgeMs: INSTANT_REPLAY_WINDOW_MS,
  }),
});

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
  /** Stops buffering and hands over what was held; `null` when nothing can be sent. */
  freeze(): Frozen | null;
  /** Starts buffering again with empty buffers. */
  restart(): void;
  /** Stops everything, the page's fetch, XHR, console and WebSocket put back. */
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

/** Starts buffering at once. Never throws. */
export function startPreClickBuffers(options: PreClickBufferOptions): PreClickBuffers {
  const { replay: module, ...rest } = options;
  const blur = createBlurController({ render: false });
  applyAutoBlur(blur, document, options.blur);
  let session: RecordingSession | undefined;
  let captures: { stop(): void } | undefined;
  let replay: ReplayRecorder | undefined;
  let running = false;

  function begin(): void {
    try {
      session = createRecordingSession({ limits: INSTANT_REPLAY_LIMITS });
      session.start();
      captures = startPageCaptures(session, {
        ...sanitizersOf(rest),
        ignoreUrls: options.ignoreUrls,
        blur,
        ignore: options.ignore,
      });
      replay = module.createReplayRecorder({
        mode: 'rolling',
        blur,
        budget: module.REPLAY_BUDGET,
      });
      replay.start();
      running = true;
    } catch {
      halt();
    }
  }

  function halt(): void {
    running = false;
    try {
      captures?.stop();
    } catch {
      // Already stopped.
    }
    captures = undefined;
    session?.stop();
    try {
      replay?.stop();
    } catch {
      // Already stopped.
    }
  }

  function snapshot(): Frozen | null {
    if (!running || replay === undefined || session === undefined) return null;
    const coverage = replay.coverage;
    if (coverage === null) return null;
    // The health closes the replay at its last event, so it never lengthens what plays.
    const events = [...replay.events(), module.replayHealthEvent(replay.health, coverage.to)];
    return {
      events,
      console: session.entries('console'),
      network: session.entries('network'),
      userEvents: session.entries('events'),
      at: Date.now(),
    };
  }

  begin();
  return {
    get available() {
      return running && replay !== undefined && replay.coverage !== null;
    },
    snapshot,
    freeze() {
      const frozen = snapshot();
      halt();
      return frozen;
    },
    restart() {
      halt();
      begin();
    },
    stop() {
      halt();
      blur.stop();
    },
  };
}
