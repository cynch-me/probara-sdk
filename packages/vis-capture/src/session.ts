import type {
  ConsoleEntry,
  EntryTime,
  NetworkEntry,
  UserEventEntry,
  WebSocketMessageEntry,
} from './entries.js';

/** The entries each stream of a recording holds; each stream becomes one diagnostics file. */
export interface StreamEntries {
  console: ConsoleEntry;
  network: NetworkEntry | WebSocketMessageEntry;
  events: UserEventEntry;
}

export type DiagnosticsStream = keyof StreamEntries;

/**
 * How much one stream keeps in memory; past either limit, the oldest entries (the smallest `t`)
 * are dropped.
 */
export interface BufferLimits {
  maxEntries: number;
  /** The size of the stream's NDJSON, in UTF-8 bytes. */
  maxBytes: number;
}

export const DEFAULT_BUFFER_LIMITS: Readonly<Record<DiagnosticsStream, Readonly<BufferLimits>>> =
  Object.freeze({
    console: Object.freeze({ maxEntries: 5000, maxBytes: 4 * 1024 * 1024 }),
    network: Object.freeze({ maxEntries: 5000, maxBytes: 16 * 1024 * 1024 }),
    events: Object.freeze({ maxEntries: 10_000, maxBytes: 2 * 1024 * 1024 }),
  });

/** The clocks of a session: a monotonic one for `t`, the wall clock for `ts`. */
export interface RecordingClock {
  /** Monotonic milliseconds, such as `performance.now()`. */
  now(): number;
  /** Epoch milliseconds, such as `Date.now()`. */
  epoch(): number;
}

export interface RecordingSessionOptions {
  limits?: { [S in DiagnosticsStream]?: Partial<BufferLimits> };
  clock?: RecordingClock;
}

export type RecordingState = 'idle' | 'recording' | 'stopped';

export interface RecordingSession {
  readonly state: RecordingState;
  /** Starts recording with empty buffers; does nothing while already recording. */
  start(): void;
  /** Stops recording; what was recorded stays readable. */
  stop(): void;
  /** The time of now: `t` since the start (0 before it), `ts` since the epoch. */
  stamp(): EntryTime;
  /**
   * Keeps `entry` in its stream while recording, in `t` order: an entry recorded after a newer one
   * (a request that ended late, typing recorded once it paused) goes before it, and entries with the
   * same `t` keep the order they were recorded in. `false` when it was not kept.
   */
  record<S extends DiagnosticsStream>(stream: S, entry: StreamEntries[S]): boolean;
  /** The entries a stream holds, oldest first: `t` never decreases. */
  entries<S extends DiagnosticsStream>(stream: S): readonly StreamEntries[S][];
  /** How many entries a stream dropped to stay within its limits. */
  dropped(stream: DiagnosticsStream): number;
}

let encoder: TextEncoder | undefined;

/** The size of an entry's NDJSON line, newline included. */
function lineBytes(entry: unknown): number {
  // Created on first use: loading the module touches no browser API.
  encoder ??= new TextEncoder();
  return encoder.encode(JSON.stringify(entry)).length + 1;
}

interface Buffer<T extends EntryTime> {
  entries: T[];
  sizes: number[];
  /** Index of the oldest kept entry: dropping moves it instead of shifting the array. */
  head: number;
  bytes: number;
  dropped: number;
}

function emptyBuffer<T extends EntryTime>(): Buffer<T> {
  return { entries: [], sizes: [], head: 0, bytes: 0, dropped: 0 };
}

const STREAMS: readonly DiagnosticsStream[] = ['console', 'network', 'events'];

const defaultClock: RecordingClock = {
  now: () => performance.now(),
  epoch: () => Date.now(),
};

export function createRecordingSession(options: RecordingSessionOptions = {}): RecordingSession {
  const clock = options.clock ?? defaultClock;
  const limits = Object.fromEntries(
    STREAMS.map((stream) => [
      stream,
      { ...DEFAULT_BUFFER_LIMITS[stream], ...options.limits?.[stream] },
    ]),
  ) as Record<DiagnosticsStream, BufferLimits>;
  let buffers = newBuffers();
  let state: RecordingState = 'idle';
  let startedAt = 0;

  function newBuffers(): { [S in DiagnosticsStream]: Buffer<StreamEntries[S]> } {
    return { console: emptyBuffer(), network: emptyBuffer(), events: emptyBuffer() };
  }

  function dropOldest(buffer: Buffer<EntryTime>): void {
    buffer.bytes -= buffer.sizes[buffer.head] ?? 0;
    buffer.head += 1;
    buffer.dropped += 1;
    // Compact once the dropped prefix is as long as what is kept.
    if (buffer.head * 2 >= buffer.entries.length) {
      buffer.entries = buffer.entries.slice(buffer.head);
      buffer.sizes = buffer.sizes.slice(buffer.head);
      buffer.head = 0;
    }
  }

  return {
    get state() {
      return state;
    },
    start() {
      if (state === 'recording') return;
      buffers = newBuffers();
      startedAt = clock.now();
      state = 'recording';
    },
    stop() {
      if (state === 'recording') state = 'stopped';
    },
    stamp() {
      return {
        t: state === 'idle' ? 0 : Math.max(0, Math.round(clock.now() - startedAt)),
        ts: Math.round(clock.epoch()),
      };
    },
    record(stream, entry) {
      if (state !== 'recording') return false;
      const buffer = buffers[stream] as Buffer<EntryTime>;
      const limit = limits[stream];
      const size = lineBytes(entry);
      if (size > limit.maxBytes || limit.maxEntries < 1) {
        buffer.dropped += 1;
        return false;
      }
      while (
        buffer.entries.length - buffer.head >= limit.maxEntries ||
        buffer.bytes + size > limit.maxBytes
      ) {
        const oldest = buffer.entries[buffer.head];
        // The entry itself is the oldest: it is the one dropped.
        if (oldest === undefined || entry.t < oldest.t) {
          buffer.dropped += 1;
          return false;
        }
        dropOldest(buffer);
      }
      // Usually the newest, so the walk back stops at once.
      let index = buffer.entries.length;
      while (index > buffer.head && (buffer.entries[index - 1] as EntryTime).t > entry.t)
        index -= 1;
      if (index === buffer.entries.length) {
        buffer.entries.push(entry);
        buffer.sizes.push(size);
      } else {
        buffer.entries.splice(index, 0, entry);
        buffer.sizes.splice(index, 0, size);
      }
      buffer.bytes += size;
      return true;
    },
    entries(stream) {
      const buffer = buffers[stream];
      return buffer.entries.slice(buffer.head);
    },
    dropped(stream) {
      return buffers[stream].dropped;
    },
  };
}
