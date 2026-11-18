/**
 * The DOM replay recorder, on rrweb's recorder (`@rrweb/record`): a stream of rrweb events a
 * player rebuilds the page from.
 * Two modes: `rolling` keeps only the last minutes, so an "instant replay" of what just happened
 * can be handed over at any moment; `full` keeps everything from `start()`. Every input and the
 * text of editable elements are masked, password fields are never recorded, and blurred elements
 * are blocked.
 *
 * This module is its own entry point (`@probara/vis-capture/replay`), so the main entry never
 * loads rrweb.
 */
import { record } from '@rrweb/record';
import { EventType, IncrementalSource, type eventWithTime } from '@rrweb/types';

/** One rrweb event. */
export type ReplayEvent = eventWithTime;

/** How often a rolling replay starts a new segment with a full snapshot. */
export const REPLAY_CHECKOUT_MS = 120_000;

/**
 * A mutation limit for a replay that runs all the time: past this many DOM mutation records
 * (nodes added or removed, texts and attributes changed) within one segment, the page is too busy
 * to record cheaply, and the replay stops. An assumption, to settle by measurement.
 */
export const REPLAY_MUTATION_LIMIT = 10_000;

/** The tag of the custom event a replay ends with when it stops by itself. */
export const REPLAY_STOPPED_TAG = 'probara/replay-stopped';

/** Why a replay stopped by itself: `mutation_limit` when the page changed too much. */
export type ReplayStopReason = 'mutation_limit';

/** Password fields are blocked whole: neither their value nor its length is recorded. */
const ALWAYS_BLOCKED = 'input[type="password" i]';
/**
 * Editable elements: rrweb's input masking does not cover them, so their text, and the text of
 * everything inside them, is masked (`*` per character), including what is typed later.
 */
const EDITABLE = '[contenteditable]:not([contenteditable="false" i])';

export type ReplayMode = 'rolling' | 'full';

export interface ReplayRecorderOptions {
  /** `rolling`: the current and the previous segment; `full`: everything since `start()`. */
  mode: ReplayMode;
  /** A rolling replay's segment length; `REPLAY_CHECKOUT_MS` unless given. */
  checkoutMs?: number;
  /** The blur controller of the recording: what it blurs is blocked, also when it changes. */
  blur?: { readonly selector: string; subscribe(listener: () => void): () => void };
  /**
   * Stops recording once a segment (everything, in full mode) holds more DOM mutation records
   * than this, keeping what it held; no limit unless given (`REPLAY_MUTATION_LIMIT` is the
   * suggested one).
   */
  mutationLimit?: number;
}

export interface ReplayRecorder {
  readonly mode: ReplayMode;
  readonly active: boolean;
  /** Why the replay stopped by itself, or `null`: a new `start()` clears it. */
  readonly stopReason: ReplayStopReason | null;
  /** Starts recording with an empty buffer; does nothing while already recording. */
  start(): void;
  /** Stops recording; what was recorded stays readable. */
  stop(): void;
  /**
   * The events held, oldest first, starting with a full snapshot: in rolling mode, between one
   * and two segments (up to twice `checkoutMs`).
   */
  events(): ReplayEvent[];
}

export function createReplayRecorder(options: ReplayRecorderOptions): ReplayRecorder {
  const { mode, blur, mutationLimit } = options;
  const checkoutMs = options.checkoutMs ?? REPLAY_CHECKOUT_MS;
  let previous: ReplayEvent[] = [];
  let current: ReplayEvent[] = [];
  let stopRecording: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let active = false;
  let stopReason: ReplayStopReason | null = null;
  /** The mutation records of the current segment. */
  let mutations = 0;

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

  function emit(event: ReplayEvent, isCheckout?: boolean): void {
    if (!active) return;
    // A checkout emits a meta event, then a full snapshot, both flagged: the meta opens the segment.
    if (isCheckout === true && mode === 'rolling' && event.type === EventType.Meta) {
      previous = current;
      current = [];
      mutations = 0;
    }
    current.push(event);
    if (mutationLimit === undefined) return;
    mutations += mutationsOf(event);
    if (mutations > mutationLimit) halt('mutation_limit');
  }

  /** Stops by itself: the events end with a custom event saying why. */
  function halt(reason: ReplayStopReason): void {
    stopReason = reason;
    current.push({
      type: EventType.Custom,
      data: { tag: REPLAY_STOPPED_TAG, payload: { reason, limit: mutationLimit } },
      timestamp: Date.now(),
    });
    // rrweb is inside its own callback here: it is stopped once that returns.
    active = false;
    unsubscribe?.();
    unsubscribe = undefined;
    const stopping = stopRecording;
    stopRecording = undefined;
    queueMicrotask(() => {
      try {
        stopping?.();
      } catch {
        // Never throw into the page.
      }
    });
  }

  function blockSelector(): string {
    const blurred = blur?.selector ?? '';
    return blurred === '' ? ALWAYS_BLOCKED : `${ALWAYS_BLOCKED}, ${blurred}`;
  }

  /** Starts rrweb; a new full snapshot opens with the current block selector. */
  function begin(): void {
    try {
      stopRecording = record({
        emit,
        blockSelector: blockSelector(),
        maskAllInputs: true,
        maskInputOptions: { password: true },
        maskTextSelector: EDITABLE,
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
  }

  return {
    mode,
    get active() {
      return active;
    },
    get stopReason() {
      return stopReason;
    },
    start() {
      if (active) return;
      end();
      previous = [];
      current = [];
      mutations = 0;
      stopReason = null;
      active = true;
      begin();
      // rrweb reads its block selector once: when what is blurred changes, start over from a
      // full snapshot that blocks it.
      unsubscribe = blur?.subscribe(() => {
        if (!active) return;
        end();
        begin();
      });
    },
    stop() {
      if (!active) return;
      unsubscribe?.();
      unsubscribe = undefined;
      end();
      active = false;
    },
    events() {
      return [...previous, ...current];
    },
  };
}
