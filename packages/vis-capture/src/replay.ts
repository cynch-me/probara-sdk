/**
 * The DOM replay recorder, on rrweb's recorder (`@rrweb/record`): a stream of rrweb events a
 * player rebuilds the page from.
 * Two modes: `rolling` keeps only the last minutes, so an "instant replay" of what just happened
 * can be handed over at any moment; `full` keeps everything from `start()`. Every input and the
 * text of editable elements are masked, password fields are never recorded, and blurred elements
 * are blocked. With a budget, a replay that keeps the page busy pauses until the page calms down,
 * instead of stopping.
 *
 * This module is its own entry point (`@probara/vis-capture/replay`), so the main entry never
 * loads rrweb.
 */
import { record } from '@rrweb/record';
import { EventType, IncrementalSource, type eventWithTime } from '@rrweb/types';
import { createBusyMeter, type BusyMeter, type ReplayBudget } from './replay-budget.js';
import { mustInlineStylesheets } from './replay-stylesheets.js';

export { REPLAY_BUDGET, type ReplayBudget } from './replay-budget.js';

/** One rrweb event. */
export type ReplayEvent = eventWithTime;

/** How often a rolling replay starts a new segment with a full snapshot. */
export const REPLAY_CHECKOUT_MS = 120_000;

/**
 * The most a rolling replay holds, in characters of JSON (`ReplayHealth`): about 16 MB of memory.
 * An assumption, to settle with the health replays report.
 */
export const REPLAY_MAX_SIZE = 16 * 1024 * 1024;

/** The tag of the custom event that marks where a replay paused (`ReplayPause`). */
export const REPLAY_PAUSED_TAG = 'probara/replay-paused';

/**
 * Why and for how long at most a replay paused: `busy` when it spent `mainThreadMs` on DOM changes
 * in `busyWindows` windows of `windowMs` in a row, each over its budget. It resumes from a new
 * full snapshot once a window's changes fit the budget again, `resumeWithinMs` at the latest.
 */
export interface ReplayPause {
  reason: 'busy';
  windowMs: number;
  busyWindows: number;
  mainThreadMs: number;
  resumeWithinMs: number;
}

/** The tag of the custom event that tells a replay's health (`replayHealthEvent`). */
export const REPLAY_HEALTH_TAG = 'probara/replay-health';

/**
 * What a replay measured about itself since `start()`. Sizes are lengths of the events' JSON text,
 * in characters (bytes for ASCII). Times are main-thread milliseconds: rrweb's work on each DOM
 * mutation batch and each full snapshot, and the recorder's own serialization.
 */
export interface ReplayHealth {
  /** How many times it paused on a busy page. */
  pauses: number;
  /** Full snapshots taken, the first one included. */
  checkouts: number;
  /** The size of the events held. */
  size: number;
  /** The size of every event recorded, the dropped ones included. */
  recordedSize: number;
  /** The largest DOM mutation batch: its records, its size and rrweb's time on it. */
  largestBatch: { records: number; size: number; ms: number } | null;
  /** The longest full snapshot. */
  longestSnapshotMs: number;
  /** Everything timed. */
  mainThreadMs: number;
}

/** The custom event that tells `health`, stamped `timestamp`. */
export function replayHealthEvent(health: ReplayHealth, timestamp: number): ReplayEvent {
  return { type: EventType.Custom, data: { tag: REPLAY_HEALTH_TAG, payload: health }, timestamp };
}

/** Password fields are blocked whole: neither their value nor its length is recorded. */
const ALWAYS_BLOCKED = 'input[type="password" i]';
/**
 * Editable elements: rrweb's input masking does not cover them, so their text, and the text of
 * everything inside them, is masked (`*` per character), including what is typed later.
 */
const EDITABLE = '[contenteditable]:not([contenteditable="false" i])';

export type ReplayMode = 'rolling' | 'full';

export interface ReplayRecorderOptions {
  /** `rolling`: the last minutes, from a full snapshot; `full`: everything since `start()`. */
  mode: ReplayMode;
  /** A rolling replay's segment length; `REPLAY_CHECKOUT_MS` unless given. */
  checkoutMs?: number;
  /**
   * How far back a rolling replay reaches at least, while it holds less than `maxSize`:
   * `checkoutMs` unless given.
   */
  lookbackMs?: number;
  /**
   * The most a rolling replay holds (`REPLAY_MAX_SIZE` unless given): past it the oldest segments
   * are dropped, and a segment that holds more than half of it, more changes than snapshot, starts
   * a new one.
   */
  maxSize?: number;
  /** The blur controller of the recording: what it blurs is blocked, also when it changes. */
  blur?: { readonly selector: string; subscribe(listener: () => void): () => void };
  /**
   * Pauses once the replay spent more main-thread time on DOM changes than this in `busyWindows`
   * windows in a row, and resumes from a new full snapshot once a whole window changes the page
   * little enough to fit it, or after `pauseMs` at the latest, then twice as long after each pause
   * that follows, up to `checkoutMs`; no budget unless given (`REPLAY_BUDGET` is the suggested
   * one).
   */
  budget?: ReplayBudget;
  /**
   * Records the content of the page's linked stylesheets (`true`) or only their addresses, which
   * the Probara servers download after the replay arrives (`false`). Unless given, decided at each
   * start and resume: addresses only when the servers can download the page's stylesheets.
   */
  inlineStylesheets?: boolean;
}

export interface ReplayRecorder {
  readonly mode: ReplayMode;
  /** Recording, paused included: between `start()` and `stop()`. */
  readonly active: boolean;
  /** Paused on a busy page, until it resumes by itself. */
  readonly paused: boolean;
  /** What the replay measured about itself since `start()`: a copy. */
  readonly health: ReplayHealth;
  /**
   * The timestamps of the first and the last event held, without reading the events; `null`
   * before the first full snapshot.
   */
  readonly coverage: { from: number; to: number } | null;
  /** Starts recording with an empty buffer; does nothing while already recording. */
  start(): void;
  /** Stops recording; what was recorded stays readable. */
  stop(): void;
  /**
   * Takes a full snapshot now, which opens a new segment, so a reader can start a replay here;
   * does nothing unless recording and not paused.
   */
  checkout(): void;
  /**
   * The events held, oldest first, starting with a full snapshot: in rolling mode, the newest
   * segments that cover `lookbackMs` within `maxSize`.
   */
  events(): ReplayEvent[];
  /**
   * Changes how far back a rolling replay reaches: what it holds stays, and is dropped only once
   * the new lookback no longer needs it.
   */
  setLookback(lookbackMs: number): void;
}

/** An event held as its JSON text, with what is read without parsing it. */
interface Held {
  type: EventType;
  timestamp: number;
  json: string;
}

/** A rolling replay's unit: what follows one full snapshot, and what it weighs. */
interface Segment {
  events: Held[];
  size: number;
  /** The size of its meta events and full snapshots. */
  snapshotSize: number;
}

const emptySegment = (): Segment => ({ events: [], size: 0, snapshotSize: 0 });

function freshHealth(): ReplayHealth {
  return {
    pauses: 0,
    checkouts: 0,
    size: 0,
    recordedSize: 0,
    largestBatch: null,
    longestSnapshotMs: 0,
    mainThreadMs: 0,
  };
}

/** The weight of DOM mutation records: the nodes they add or remove, one at least each. */
function weightOf(mutations: readonly MutationRecord[]): number {
  let weight = 0;
  for (const mutation of mutations) {
    weight += Math.max(1, mutation.addedNodes.length + mutation.removedNodes.length);
  }
  return weight;
}

export function createReplayRecorder(options: ReplayRecorderOptions): ReplayRecorder {
  const { mode, blur, budget } = options;
  const checkoutMs = options.checkoutMs ?? REPLAY_CHECKOUT_MS;
  let lookbackMs = options.lookbackMs ?? checkoutMs;
  const maxSize = options.maxSize ?? REPLAY_MAX_SIZE;
  /** Oldest first; in full mode, one. */
  let segments: Segment[] = [emptySegment()];
  let checkoutQueued = false;
  let health = freshHealth();
  /** When rrweb's current full snapshot began: its meta event is emitted first. */
  let snapshotStart = 0;
  /**
   * When the page's current DOM mutations reached the observers, or 0: set by an observer created
   * before rrweb's, which runs first, and cleared once every observer has run.
   */
  let mutationStart = 0;
  let timer: MutationObserver | undefined;
  let stopRecording: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let active = false;
  let paused = false;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let calmTimer: ReturnType<typeof setInterval> | undefined;
  /** Pauses since the replay last recorded a whole checkout interval without one. */
  let pausesInARow = 0;
  let resumedAt = 0;
  let meter: BusyMeter | undefined;

  /** How many DOM mutation records an event holds. */
  function mutationsOf(event: ReplayEvent): number {
    if (event.type !== EventType.IncrementalSnapshot) return 0;
    const data = event.data as {
      source?: number;
      adds?: unknown[];
      removes?: unknown[];
      texts?: unknown[];
      attributes?: unknown[];
    };
    if (data.source !== IncrementalSource.Mutation) return 0;
    return (
      (data.adds?.length ?? 0) +
      (data.removes?.length ?? 0) +
      (data.texts?.length ?? 0) +
      (data.attributes?.length ?? 0)
    );
  }

  function emit(event: ReplayEvent): void {
    if (!active || paused) return;
    const reached = performance.now();
    // A full snapshot comes after its meta event, which opens a segment.
    if (event.type === EventType.Meta) {
      snapshotStart = reached;
      const current = segments[segments.length - 1];
      if (mode === 'rolling' && current !== undefined && current.events.length > 0) {
        segments.push(emptySegment());
      }
    }
    const json = JSON.stringify(event);
    const records = mutationsOf(event);
    let rrwebMs = 0;
    if (event.type === EventType.FullSnapshot) {
      rrwebMs = reached - snapshotStart;
      health.checkouts += 1;
      health.longestSnapshotMs = Math.max(health.longestSnapshotMs, rrwebMs);
    } else if (records > 0) {
      rrwebMs = mutationStart === 0 ? 0 : reached - mutationStart;
      if (records > (health.largestBatch?.records ?? 0)) {
        health.largestBatch = { records, size: json.length, ms: rrwebMs };
      }
    }
    hold({ type: event.type, timestamp: event.timestamp, json });
    if (mode === 'rolling') bound();
    const spent = rrwebMs + (performance.now() - reached);
    health.mainThreadMs += spent;
    // Full snapshots are bounded by the checkouts: only DOM changes count against the budget.
    const busy = records > 0 && budget !== undefined ? meter?.spent(reached, spent) : null;
    if (busy && budget !== undefined) pause(budget, busy.mainThreadMs);
  }

  function hold(held: Held): void {
    const segment = segments[segments.length - 1] ?? emptySegment();
    segment.events.push(held);
    segment.size += held.json.length;
    if (held.type === EventType.Meta || held.type === EventType.FullSnapshot) {
      segment.snapshotSize += held.json.length;
    }
    health.recordedSize += held.json.length;
  }

  /**
   * Drops the oldest segments the lookback does not need, or that the size cap cannot hold, and
   * checks out early when the current segment holds more than half the cap: what is held then
   * stays between half the cap and the cap.
   */
  function bound(): void {
    let total = segments.reduce((sum, segment) => sum + segment.size, 0);
    while (segments.length > 1) {
      const next = segments[1]?.events[0];
      const needed = next !== undefined && next.timestamp > Date.now() - lookbackMs;
      if (needed && total <= maxSize) break;
      total -= segments.shift()?.size ?? 0;
    }
    const current = segments[segments.length - 1];
    if (current === undefined || current.size <= maxSize / 2) return;
    // A checkout costs about its snapshot: only worth it once the changes outweigh it.
    if (current.size - current.snapshotSize <= current.snapshotSize) return;
    if (checkoutQueued) return;
    checkoutQueued = true;
    // rrweb may check out by itself once this event is handled: one checkout at a time.
    queueMicrotask(() => {
      checkoutQueued = false;
      if (!active || stopRecording === undefined) return;
      try {
        record.takeFullSnapshot(true);
      } catch {
        // Never throw into the page.
      }
    });
  }

  /**
   * Pauses on a busy page: the events go on with a custom event saying why and for how long, and
   * rrweb stops until the replay resumes from a new full snapshot.
   */
  function pause(budget: ReplayBudget, spent: number): void {
    const now = Date.now();
    if (now - resumedAt > checkoutMs) pausesInARow = 0;
    const resumeWithinMs = Math.min(budget.pauseMs * 2 ** pausesInARow, checkoutMs);
    pausesInARow += 1;
    paused = true;
    health.pauses += 1;
    const payload: ReplayPause = {
      reason: 'busy',
      windowMs: budget.windowMs,
      busyWindows: budget.busyWindows,
      mainThreadMs: Math.round(spent),
      resumeWithinMs,
    };
    const marker: ReplayEvent = {
      type: EventType.Custom,
      data: { tag: REPLAY_PAUSED_TAG, payload },
      timestamp: now,
    };
    hold({ type: marker.type, timestamp: marker.timestamp, json: JSON.stringify(marker) });
    // rrweb is inside its own callback here: it is stopped once that returns. The timer goes on
    // weighing the page's changes, to resume once they fit the budget.
    const stopping = stopRecording;
    stopRecording = undefined;
    mutationStart = 0;
    queueMicrotask(() => {
      try {
        stopping?.();
      } catch {
        // Never throw into the page.
      }
    });
    resumeTimer = setTimeout(resume, resumeWithinMs);
    calmTimer = setInterval(() => {
      if (meter?.calm() === true) resume();
    }, budget.windowMs);
  }

  function resume(): void {
    cancelResume();
    if (!active) return;
    resumedAt = Date.now();
    end();
    begin();
  }

  function cancelResume(): void {
    if (resumeTimer !== undefined) clearTimeout(resumeTimer);
    resumeTimer = undefined;
    if (calmTimer !== undefined) clearInterval(calmTimer);
    calmTimer = undefined;
    paused = false;
  }

  function blockSelector(): string {
    const blurred = blur?.selector ?? '';
    return blurred === '' ? ALWAYS_BLOCKED : `${ALWAYS_BLOCKED}, ${blurred}`;
  }

  /** Starts rrweb; a new full snapshot opens with the current block selector. */
  function begin(): void {
    meter?.reset(performance.now());
    try {
      timer = new MutationObserver((mutations) => {
        mutationStart = performance.now();
        meter?.changed(mutationStart, weightOf(mutations));
        queueMicrotask(() => {
          mutationStart = 0;
        });
      });
      timer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      stopRecording = record({
        emit,
        blockSelector: blockSelector(),
        maskAllInputs: true,
        maskInputOptions: { password: true },
        maskTextSelector: EDITABLE,
        inlineStylesheet: options.inlineStylesheets ?? mustInlineStylesheets(document),
        // Frameworks leave anchor comments around every template; rrweb skips them when it places a
        // node, so dropping them costs nothing in the replay.
        slimDOMOptions: { comment: true },
        ...(mode === 'rolling' ? { checkoutEveryNms: checkoutMs } : {}),
        // An error inside rrweb is handled here, never thrown into the page.
        errorHandler: () => true,
      });
    } catch {
      stopRecording = undefined;
    }
  }

  function end(): void {
    try {
      stopRecording?.();
    } catch {
      // Never throw into the page.
    }
    stopRecording = undefined;
    timer?.disconnect();
    timer = undefined;
    mutationStart = 0;
  }

  return {
    mode,
    get active() {
      return active;
    },
    get paused() {
      return paused;
    },
    get health() {
      return {
        ...health,
        size: segments.reduce((sum, segment) => sum + segment.size, 0),
        largestBatch: health.largestBatch === null ? null : { ...health.largestBatch },
      };
    },
    get coverage() {
      const held = segments.flatMap((segment) => segment.events);
      const first = held[0];
      const last = held.at(-1);
      const snapshot = held.some((event) => event.type === EventType.FullSnapshot);
      return first === undefined || last === undefined || !snapshot
        ? null
        : { from: first.timestamp, to: last.timestamp };
    },
    start() {
      if (active) return;
      end();
      cancelResume();
      segments = [emptySegment()];
      checkoutQueued = false;
      health = freshHealth();
      meter = budget === undefined ? undefined : createBusyMeter(budget, performance.now());
      pausesInARow = 0;
      resumedAt = Date.now();
      active = true;
      begin();
      // rrweb reads its block selector once: when what is blurred changes, start over from a
      // full snapshot that blocks it. A paused replay reads it when it resumes.
      unsubscribe = blur?.subscribe(() => {
        if (!active || paused) return;
        end();
        begin();
      });
    },
    stop() {
      if (!active) return;
      unsubscribe?.();
      unsubscribe = undefined;
      cancelResume();
      end();
      active = false;
    },
    checkout() {
      if (!active || paused || stopRecording === undefined) return;
      try {
        record.takeFullSnapshot(true);
      } catch {
        // Never throw into the page.
      }
    },
    setLookback(next) {
      lookbackMs = next;
    },
    events() {
      return segments.flatMap((segment) =>
        segment.events.map((held) => JSON.parse(held.json) as ReplayEvent),
      );
    },
  };
}
