/**
 * The page-wide shared capture: one set of console, network, WebSocket and user event
 * interceptors and at most one DOM replay recorder for every Probara SDK on the page. The first SDK
 * to attach starts it and registers it on the page under `Symbol.for('probara.capture')`; the
 * others, whatever copy of this package they bundle, attach to it there. Each one reads what it
 * holds without emptying it (`snapshot`), and the page is put back once the last one releases
 * it. The sanitizers, ignored URLs and ignored elements of every attached SDK apply to everything
 * captured.
 *
 * The replay recorder is handed in (`CaptureReplayModule`, the `@probara/vis-capture/replay`
 * entry), so this module never loads the recorder's library. The replay blurs the privacy markers
 * (`applyAutoBlur`) and every selector an attached SDK names, and never hands over what it recorded
 * before what is blurred last changed.
 */
import { applyAutoBlur } from './auto-blur.js';
import { createBlurController, type BlurController } from './blur.js';
import type {
  NetworkEntry,
  WebSocketMessageEntry,
  ConsoleEntry,
  UserEventEntry,
} from './entries.js';
import type { UrlPattern } from './network.js';
import { startPageCaptures } from './page-captures.js';
import type { ReplayBudget } from './replay-budget.js';
import type { Sanitizers } from './sanitize.js';
import {
  createRecordingSession,
  type BufferLimits,
  type DiagnosticsStream,
  type RecordingSession,
  type ResizableRecordingSession,
  type StreamEntries,
} from './session.js';

/** Where the shared capture is registered on the page. */
export const SHARED_CAPTURE_KEY = Symbol.for('probara.capture');

/** The version of what is registered under `SHARED_CAPTURE_KEY`; it changes when its shape does. */
export const SHARED_CAPTURE_PROTOCOL = 1;

/** How far back the console, network and user events of the shared capture go. */
export const SHARED_CAPTURE_WINDOW_MS = 5 * 60_000;

/** What each diagnostics stream of the shared capture holds at most, besides its time window. */
export const SHARED_CAPTURE_LIMITS: Readonly<Record<DiagnosticsStream, Readonly<BufferLimits>>> =
  Object.freeze({
    console: Object.freeze({
      maxEntries: 1000,
      maxBytes: 1024 * 1024,
      maxAgeMs: SHARED_CAPTURE_WINDOW_MS,
    }),
    network: Object.freeze({
      maxEntries: 1000,
      maxBytes: 8 * 1024 * 1024,
      maxAgeMs: SHARED_CAPTURE_WINDOW_MS,
    }),
    events: Object.freeze({
      maxEntries: 2000,
      maxBytes: 1024 * 1024,
      maxAgeMs: SHARED_CAPTURE_WINDOW_MS,
    }),
  });

/** How far back the shared capture goes while only error monitoring is attached. */
export const ERROR_CAPTURE_WINDOW_MS = 60_000;

/**
 * What each diagnostics stream of the shared capture holds at most while only error monitoring is
 * attached: enough for an event's breadcrumbs, besides its time window.
 */
export const ERROR_CAPTURE_LIMITS: Readonly<Record<DiagnosticsStream, Readonly<BufferLimits>>> =
  Object.freeze({
    console: Object.freeze({
      maxEntries: 100,
      maxBytes: 128 * 1024,
      maxAgeMs: ERROR_CAPTURE_WINDOW_MS,
    }),
    network: Object.freeze({
      maxEntries: 100,
      maxBytes: 128 * 1024,
      maxAgeMs: ERROR_CAPTURE_WINDOW_MS,
    }),
    events: Object.freeze({
      maxEntries: 200,
      maxBytes: 128 * 1024,
      maxAgeMs: ERROR_CAPTURE_WINDOW_MS,
    }),
  });

/**
 * How much an SDK needs the shared capture to keep: `full`, Vis's window with request and response
 * bodies, or `errors`, error monitoring's shorter window without bodies. The capture keeps the
 * most any attached SDK needs, and grows or shrinks, keeping what it holds, as they come and go.
 */
export type CaptureRetention = 'full' | 'errors';

/** The replay's meta event, which opens every full snapshot. */
const META_EVENT = 4;

/** One replay event, as far as the shared capture reads it. */
export interface CaptureReplayEvent {
  type: number;
  timestamp: number;
}

/** A replay recorder, as far as the shared capture drives it (`ReplayRecorder`). */
export interface CaptureReplayRecorder {
  readonly health: object;
  readonly coverage: { from: number; to: number } | null;
  start(): void;
  stop(): void;
  checkout(): void;
  events(): CaptureReplayEvent[];
  /** Changes how far back the replay reaches; a recorder without it keeps its lookback. */
  setLookback?(lookbackMs: number): void;
}

/** The replay entry, `@probara/vis-capture/replay`, as far as the shared capture uses it. */
export interface CaptureReplayModule {
  readonly REPLAY_BUDGET: ReplayBudget;
  createReplayRecorder(options: {
    mode: 'rolling' | 'full';
    lookbackMs?: number;
    blur?: { readonly selector: string; subscribe(listener: () => void): () => void };
    budget?: ReplayBudget;
  }): CaptureReplayRecorder;
  replayHealthEvent(health: object, timestamp: number): CaptureReplayEvent;
}

/** What one SDK adds to the shared capture while it is attached. */
export interface SharedCaptureOptions extends Sanitizers {
  /** Requests never captured, such as the SDK's own. */
  ignoreUrls?: readonly UrlPattern[];
  /** Elements whose user events are never captured, such as the SDK's own controls. */
  ignore?: (element: Element) => boolean;
  /** CSS selectors blurred in the replay, on top of the privacy markers; invalid ones are skipped. */
  blur?: readonly string[];
  /** Starts the replay recorder with this entry unless one runs already. */
  replay?: CaptureReplayModule;
  /** How much this SDK needs kept: `full` unless given. */
  retention?: CaptureRetention;
}

/** One entry the shared capture recorded, as it is handed to subscribers. */
export type CaptureRecord =
  | { stream: 'console'; entry: ConsoleEntry }
  | { stream: 'network'; entry: NetworkEntry | WebSocketMessageEntry }
  | { stream: 'events'; entry: UserEventEntry };

export type CaptureListener = (record: CaptureRecord) => void;

/** What the shared capture held when it was read, from the reader's point of view. */
export interface CaptureSnapshot {
  /** The replay, from a full snapshot, ending with its health stamped `at`. */
  events: CaptureReplayEvent[];
  console: readonly StreamEntries['console'][];
  network: readonly StreamEntries['network'][];
  userEvents: readonly StreamEntries['events'][];
  /** Epoch milliseconds of the copy. */
  at: number;
}

export interface SharedCapture {
  /** This SDK started the capture; `false` when it attached to one already running. */
  readonly owner: boolean;
  /** A replay that can be played is held for this SDK. */
  readonly available: boolean;
  /** The blur of the capture: what it blurs is blocked in the replay, without changing the page. */
  readonly blur: BlurController;
  /** Starts the replay recorder with `module`, unless one runs already. */
  startReplay(module: CaptureReplayModule): void;
  /**
   * A copy of what is held, capturing on; `null` without a replay to play. With `lookbackMs`,
   * from the newest full snapshot that still covers that many milliseconds.
   */
  snapshot(options?: { lookbackMs?: number }): CaptureSnapshot | null;
  /**
   * Starts this SDK's view over from now, from a new full snapshot; what the others read is left
   * whole.
   */
  restart(): void;
  /** Calls `listener` with each entry captured from now on; returns the unsubscribe function. */
  subscribe(listener: CaptureListener): () => void;
  /** Detaches this SDK; the last one to release stops the capture and puts the page back. */
  release(): void;
}

/** What is registered on the page under `SHARED_CAPTURE_KEY`. */
interface SharedCaptureRegistry {
  readonly protocol: typeof SHARED_CAPTURE_PROTOCOL;
  attach(options: SharedCaptureOptions): SharedCapture;
}

interface Participant {
  options: SharedCaptureOptions;
  ignoreUrls: readonly UrlPattern[];
  listeners: Set<CaptureListener>;
  /** Epoch milliseconds this participant's view starts at. */
  since: number;
  /** The entries held when the view last started over, left out of it. */
  before: WeakSet<object>;
}

function isRegistry(value: unknown): value is SharedCaptureRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { protocol?: unknown }).protocol === SHARED_CAPTURE_PROTOCOL &&
    typeof (value as { attach?: unknown }).attach === 'function'
  );
}

/**
 * Attaches to the page's shared capture, starting it when none runs. Never throws into the page:
 * a capture another protocol registered is left alone, and this SDK captures on its own.
 */
export function attachSharedCapture(options: SharedCaptureOptions = {}): SharedCapture {
  const page = globalThis as Record<symbol, unknown>;
  const existing = page[SHARED_CAPTURE_KEY];
  if (isRegistry(existing)) return existing.attach(options);
  if (existing !== undefined) return createSharedCapture(() => undefined).attach(options);
  const registry = createSharedCapture(() => {
    if (page[SHARED_CAPTURE_KEY] === registry) Reflect.deleteProperty(page, SHARED_CAPTURE_KEY);
  });
  page[SHARED_CAPTURE_KEY] = registry;
  return registry.attach(options);
}

/** The newest full snapshot at or before `from` that is not older than `since`, or the first. */
function startOfReplay(events: readonly CaptureReplayEvent[], since: number, from: number): number {
  let start = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type !== META_EVENT || event.timestamp < since) continue;
    if (start === -1 || event.timestamp <= from) start = index;
    if (event.timestamp > from) break;
  }
  return start;
}

function createSharedCapture(onStopped: () => void): SharedCaptureRegistry {
  const participants = new Set<Participant>();
  const ignoreUrls: UrlPattern[] = [];
  let blur: BlurController | undefined;
  let session: ResizableRecordingSession | undefined;
  /** What the attached SDKs need kept, which the capture is sized for. */
  let retention: CaptureRetention = 'full';
  let captures: { stop(): void } | undefined;
  let replay: { module: CaptureReplayModule; recorder: CaptureReplayRecorder } | undefined;
  /** Epoch milliseconds what is blurred last changed: the replay before it is never handed over. */
  let blurredSince = 0;

  function chain<T>(pick: (options: SharedCaptureOptions) => ((value: T) => T | null) | undefined) {
    return (value: T): T | null => {
      let current: T | null = value;
      for (const participant of participants) {
        const sanitizer = pick(participant.options);
        if (sanitizer === undefined) continue;
        if (current === null || typeof current !== 'object') return current;
        current = sanitizer(current);
      }
      return current;
    };
  }

  function notify(record: CaptureRecord): void {
    for (const participant of participants) {
      for (const listener of participant.listeners) {
        try {
          listener(record);
        } catch {
          // A listener never breaks the capture.
        }
      }
    }
  }

  function neededRetention(): CaptureRetention {
    for (const participant of participants) {
      if ((participant.options.retention ?? 'full') === 'full') return 'full';
    }
    return 'errors';
  }

  const windowOf = (kept: CaptureRetention): number =>
    kept === 'full' ? SHARED_CAPTURE_WINDOW_MS : ERROR_CAPTURE_WINDOW_MS;
  const limitsOf = (kept: CaptureRetention) =>
    kept === 'full' ? SHARED_CAPTURE_LIMITS : ERROR_CAPTURE_LIMITS;

  /** Sizes the capture for what the attached SDKs need now, keeping what still fits. */
  function resize(): void {
    const needed = neededRetention();
    if (needed === retention) return;
    retention = needed;
    session?.setLimits(limitsOf(needed));
    try {
      replay?.recorder.setLookback?.(windowOf(needed));
    } catch {
      // A recorder that cannot change keeps its lookback.
    }
  }

  function tap(inner: RecordingSession): RecordingSession {
    return {
      get state() {
        return inner.state;
      },
      start: () => {
        inner.start();
      },
      stop: () => {
        inner.stop();
      },
      stamp: () => inner.stamp(),
      record(stream, entry) {
        const kept = inner.record(stream, entry);
        if (inner.state === 'recording') notify({ stream, entry } as CaptureRecord);
        return kept;
      },
      entries: (stream) => inner.entries(stream),
      dropped: (stream) => inner.dropped(stream),
    };
  }

  function start(): void {
    blur = createBlurController({ render: false });
    applyAutoBlur(blur, document);
    // Subscribed before the recorder: its new full snapshot comes after this time.
    blur.subscribe(() => {
      blurredSince = Date.now();
    });
    retention = neededRetention();
    const inner = createRecordingSession({ limits: limitsOf(retention) });
    inner.start();
    session = inner;
    captures = startPageCaptures(tap(inner), {
      logSanitizer: chain((options) => options.logSanitizer),
      requestSanitizer: chain((options) => options.requestSanitizer),
      responseSanitizer: chain((options) => options.responseSanitizer),
      webSocketSanitizer: chain((options) => options.webSocketSanitizer),
      ignoreUrls,
      blur,
      captureBodies: () => retention === 'full',
      ignore: (element) =>
        [...participants].some((participant) => participant.options.ignore?.(element) === true),
    });
  }

  function startReplay(module: CaptureReplayModule): void {
    if (replay !== undefined || blur === undefined) return;
    try {
      const recorder = module.createReplayRecorder({
        mode: 'rolling',
        lookbackMs: windowOf(retention),
        blur,
        budget: module.REPLAY_BUDGET,
      });
      recorder.start();
      replay = { module, recorder };
    } catch {
      replay = undefined;
    }
  }

  function stop(): void {
    try {
      captures?.stop();
    } catch {
      // Already stopped.
    }
    try {
      replay?.recorder.stop();
    } catch {
      // Already stopped.
    }
    session?.stop();
    blur?.stop();
    blurredSince = 0;
    captures = undefined;
    replay = undefined;
    session = undefined;
    blur = undefined;
    onStopped();
  }

  function snapshot(participant: Participant, lookbackMs?: number): CaptureSnapshot | null {
    if (session === undefined || replay === undefined || replay.recorder.coverage === null) {
      return null;
    }
    const at = Date.now();
    const from = Math.max(participant.since, lookbackMs === undefined ? 0 : at - lookbackMs);
    const held = replay.recorder.events();
    const first = startOfReplay(held, Math.max(participant.since, blurredSince), from);
    if (first === -1) return null;
    // The health closes the replay at the copy: what was logged after the last change still plays.
    const events = [
      ...held.slice(first),
      replay.module.replayHealthEvent(replay.recorder.health, at),
    ];
    const recent = (entry: { ts: number }): boolean =>
      entry.ts >= from && !participant.before.has(entry);
    return {
      events,
      console: session.entries('console').filter(recent),
      network: session.entries('network').filter(recent),
      userEvents: session.entries('events').filter(recent),
      at,
    };
  }

  function attach(options: SharedCaptureOptions): SharedCapture {
    const owner = participants.size === 0;
    const participant: Participant = {
      options,
      ignoreUrls: options.ignoreUrls ?? [],
      listeners: new Set(),
      since: 0,
      before: new WeakSet(),
    };
    participants.add(participant);
    ignoreUrls.push(...participant.ignoreUrls);
    if (owner) start();
    else resize();
    if (blur !== undefined && options.blur !== undefined)
      applyAutoBlur(blur, document, options.blur);
    if (options.replay !== undefined) startReplay(options.replay);
    let released = false;
    const controller = blur as BlurController;
    return {
      owner,
      get available() {
        const coverage = released ? null : (replay?.recorder.coverage ?? null);
        return coverage !== null && coverage.to >= Math.max(participant.since, blurredSince);
      },
      blur: controller,
      startReplay(module) {
        if (!released) startReplay(module);
      },
      snapshot(read) {
        return released ? null : snapshot(participant, read?.lookbackMs);
      },
      restart() {
        if (released) return;
        participant.since = Date.now();
        const held = session;
        participant.before = new WeakSet(
          held === undefined
            ? []
            : [...held.entries('console'), ...held.entries('network'), ...held.entries('events')],
        );
        replay?.recorder.checkout();
      },
      subscribe(listener) {
        participant.listeners.add(listener);
        return () => participant.listeners.delete(listener);
      },
      release() {
        if (released) return;
        released = true;
        participants.delete(participant);
        participant.listeners.clear();
        for (const pattern of participant.ignoreUrls) {
          const index = ignoreUrls.indexOf(pattern);
          if (index !== -1) ignoreUrls.splice(index, 1);
        }
        if (participants.size === 0) stop();
        else resize();
      },
    };
  }

  return { protocol: SHARED_CAPTURE_PROTOCOL, attach };
}
