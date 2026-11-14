/**
 * The DOM replay recorder, on rrweb: a stream of rrweb events a player rebuilds the page from.
 * Two modes: `rolling` keeps only the last minutes, so an "instant replay" of what just happened
 * can be handed over at any moment; `full` keeps everything from `start()`. Every input and the
 * text of editable elements are masked, password fields are never recorded, and blurred elements
 * are blocked.
 *
 * This module is its own entry point (`@probara/vis-capture/replay`), so the main entry never
 * loads rrweb.
 */
import { EventType, record, type eventWithTime } from 'rrweb';

/** One rrweb event. */
export type ReplayEvent = eventWithTime;

/** How often a rolling replay starts a new segment with a full snapshot. */
export const REPLAY_CHECKOUT_MS = 120_000;

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
}

export interface ReplayRecorder {
  readonly mode: ReplayMode;
  readonly active: boolean;
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
  const { mode, blur } = options;
  const checkoutMs = options.checkoutMs ?? REPLAY_CHECKOUT_MS;
  let previous: ReplayEvent[] = [];
  let current: ReplayEvent[] = [];
  let stopRecording: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let active = false;

  function emit(event: ReplayEvent, isCheckout?: boolean): void {
    if (!active) return;
    // A checkout emits a meta event, then a full snapshot, both flagged: the meta opens the segment.
    if (isCheckout === true && mode === 'rolling' && event.type === EventType.Meta) {
      previous = current;
      current = [];
    }
    current.push(event);
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
    start() {
      if (active) return;
      previous = [];
      current = [];
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
