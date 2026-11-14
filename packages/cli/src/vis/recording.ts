/**
 * What `vis record` keeps of a recording, from the messages the page sends through the CDP
 * binding. Every message is untrusted (the recorded page is any site): it is size-checked before
 * it is parsed, its shape is checked against the engine's entry types, and an entry keeps only
 * the fields of its kind, so a page can neither exhaust the CLI's memory nor pass one kind of
 * entry for another.
 *
 * Where it is kept: the DOM replay goes to a file on disk as it arrives (it is the large part),
 * bounded by {@link MAX_REPLAY_BYTES}; the console, network and user event streams stay in memory,
 * in the engine's own recording buffers, which keep the newest entries within their limits.
 *
 * The clock is the engine's: the recording starts at the timestamp of the first replay event the
 * page recorded, every line is timed from it, and its length is the last replay event's, never
 * more than the limit, however late the CLI's own timer fired.
 */
import { createReadStream, openSync, closeSync, writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  createRecordingSession,
  gzipNdjson,
  isConsoleEntry,
  isNetworkEntry,
  isUserEventEntry,
  isWebSocketMessageEntry,
  sanitizeConsoleEntry,
  sanitizeNetworkEntry,
  sanitizeWebSocketEntry,
  type ConsoleEntry,
  type DiagnosticsStream,
  type NetworkEntry,
  type UserEventEntry,
  type WebSocketMessageEntry,
} from '@probara/vis-capture';
import { redactEvent } from './playwright-trace.js';

/** The largest message the page may send, in UTF-16 code units (a full snapshot of a big page). */
export const MAX_MESSAGE_LENGTH = 32 * 1024 * 1024;
/** The most replay a recording keeps on disk, uncompressed; the recording ends when it is reached. */
export const MAX_REPLAY_BYTES = 1024 * 1024 * 1024;
/** The longest environment message kept. */
const MAX_ENVIRONMENT_LENGTH = 16 * 1024;
/** The highest rrweb event type (`Plugin`). */
const MAX_REPLAY_EVENT_TYPE = 6;

const STREAMS: readonly DiagnosticsStream[] = ['console', 'network', 'events'];

/** The environment of a Vis, as Probara's strict schema takes it. */
export interface RecordedEnvironment {
  pageUrl?: string;
  pageTitle?: string;
  environment: Record<string, unknown>;
}

/** A compressed diagnostics stream, ready to upload. */
export interface RecordedStream {
  kind: DiagnosticsStream;
  count: number;
  bytes: Uint8Array<ArrayBuffer>;
}

/** The replay and the streams of a recording, cut at a length. */
export interface RecordingOutput {
  durationMs: number;
  replayPath: string;
  replayBytes: number;
  replayEvents: number;
  streams: RecordedStream[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Only the named fields of `value` that it holds. */
function pick(value: object, keys: readonly string[]): Record<string, unknown> {
  const fields = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in fields && fields[key] !== undefined) out[key] = fields[key];
  return out;
}

const CONSOLE_KEYS = ['t', 'ts', 'level', 'args', 'stack', 'source'];
const NETWORK_KEYS = [
  't',
  'ts',
  'id',
  'kind',
  'method',
  'url',
  'status',
  'requestHeaders',
  'responseHeaders',
  'requestBody',
  'responseBody',
  'durationMs',
  'timing',
  'error',
  'graphql',
];
const SOCKET_KEYS = ['t', 'ts', 'socketId', 'direction', 'data'];
const EVENT_KEYS = ['t', 'ts', 'type', 'target', 'url', 'value', 'x', 'y'];

/** An rrweb event: an event type, a timestamp and its data. */
function isReplayEvent(value: unknown): value is { type: number; timestamp: number } {
  return (
    isRecord(value) &&
    Number.isInteger(value.type) &&
    (value.type as number) >= 0 &&
    (value.type as number) <= MAX_REPLAY_EVENT_TYPE &&
    isFiniteNumber(value.timestamp) &&
    value.timestamp > 0 &&
    isRecord(value.data)
  );
}

function trimmed(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' || text.length > max ? undefined : text;
}

function software(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const key of ['name', 'version']) {
    const text = trimmed(value[key], 100);
    if (text !== undefined) out[key] = text;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function dimensions(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const key of ['width', 'height']) {
    const size = value[key];
    if (Number.isInteger(size) && (size as number) > 0 && (size as number) <= 100_000) {
      out[key] = size as number;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * The environment the engine reported, reduced to what Probara's schema takes: every member it
 * knows, in its bounds, and nothing else (an unknown member, `country` included, would make
 * Probara refuse the Vis).
 */
export function environmentOf(value: unknown): RecordedEnvironment | undefined {
  if (!isRecord(value) || !isRecord(value.environment)) return undefined;
  const given = value.environment;
  const environment: Record<string, unknown> = {};
  const set = (key: string, kept: unknown) => {
    if (kept !== undefined) environment[key] = kept;
  };
  set('browser', software(given.browser));
  set('os', software(given.os));
  set('device', trimmed(given.device, 100));
  set('viewport', dimensions(given.viewport));
  set('screen', dimensions(given.screen));
  const ratio = given.pixelRatio;
  set('pixelRatio', isFiniteNumber(ratio) && ratio > 0 && ratio <= 20 ? ratio : undefined);
  set('locale', trimmed(given.locale, 35));
  set('timeZone', trimmed(given.timeZone, 100));
  const agent = given.userAgent;
  set(
    'userAgent',
    typeof agent === 'string' && agent !== '' && agent.length <= 1000 ? agent : undefined,
  );
  set('networkType', trimmed(given.networkType, 20));
  if (typeof given.incognito === 'boolean') environment.incognito = given.incognito;
  const out: RecordedEnvironment = { environment };
  const pageUrl = typeof value.pageUrl === 'string' ? value.pageUrl : undefined;
  if (pageUrl !== undefined && pageUrl.length <= 2048 && /^https?:\/\//.test(pageUrl)) {
    out.pageUrl = pageUrl;
  }
  const pageTitle = trimmed(value.pageTitle, 500);
  if (pageTitle !== undefined) out.pageTitle = pageTitle;
  return out;
}

/** An entry of `stream` with only the fields of its kind, or `undefined` when it is no such entry. */
function entryOf(stream: DiagnosticsStream, value: unknown) {
  if (stream === 'console') {
    return isConsoleEntry(value)
      ? (pick(value, CONSOLE_KEYS) as unknown as ConsoleEntry)
      : undefined;
  }
  if (stream === 'network') {
    if (isNetworkEntry(value)) return pick(value, NETWORK_KEYS) as unknown as NetworkEntry;
    if (isWebSocketMessageEntry(value)) {
      return pick(value, SOCKET_KEYS) as unknown as WebSocketMessageEntry;
    }
    return undefined;
  }
  return isUserEventEntry(value)
    ? (pick(value, EVENT_KEYS) as unknown as UserEventEntry)
    : undefined;
}

/** An entry redacted the way the CLI redacts a Playwright trace, before anything is sent. */
function redacted(stream: DiagnosticsStream, entry: object): object | null {
  if (stream === 'console') return sanitizeConsoleEntry(entry as ConsoleEntry);
  if (stream === 'events') return redactEvent(entry as UserEventEntry);
  if ('socketId' in entry) return sanitizeWebSocketEntry(entry as WebSocketMessageEntry);
  return sanitizeNetworkEntry(entry as NetworkEntry);
}

export interface RecordingBufferOptions {
  /** The file the replay goes to. */
  replayPath: string;
  /** The longest recording: replay events past it are not kept. */
  capMs: number;
}

export function createRecordingBuffer({ replayPath, capMs }: RecordingBufferOptions) {
  const session = createRecordingSession();
  session.start();
  const fd = openSync(replayPath, 'w');
  let fdOpen = true;
  let startTs: number | undefined;
  let lastTs: number | undefined;
  let replayBytes = 0;
  let replayEvents = 0;
  let ignored = 0;
  let full = false;
  let environment: RecordedEnvironment | undefined;

  function keepReplay(events: unknown[]): boolean {
    if (!events.every(isReplayEvent)) return false;
    for (const event of events) {
      startTs ??= event.timestamp;
      if (event.timestamp < startTs || event.timestamp > startTs + capMs) continue;
      const line = `${JSON.stringify(event)}\n`;
      const bytes = Buffer.byteLength(line);
      if (replayBytes + bytes > MAX_REPLAY_BYTES) {
        full = true;
        return true;
      }
      writeSync(fd, line);
      replayBytes += bytes;
      replayEvents += 1;
      lastTs = Math.max(lastTs ?? event.timestamp, event.timestamp);
    }
    return true;
  }

  return {
    /** Takes one binding message of the page; one that is not valid capture data is counted and dropped. */
    accept(payload: string): void {
      if (!fdOpen || payload.length > MAX_MESSAGE_LENGTH) {
        ignored += 1;
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(payload);
      } catch {
        ignored += 1;
        return;
      }
      if (!isRecord(message)) {
        ignored += 1;
        return;
      }
      const { kind } = message;
      if (kind === 'replay' && Array.isArray(message.events)) {
        if (!keepReplay(message.events)) ignored += 1;
        return;
      }
      if (kind === 'environment') {
        const kept =
          JSON.stringify(message.environment ?? null).length <= MAX_ENVIRONMENT_LENGTH
            ? environmentOf(message.environment)
            : undefined;
        if (kept === undefined) ignored += 1;
        // The first document's environment is the recording's.
        else environment ??= kept;
        return;
      }
      if (kind === 'console' || kind === 'network' || kind === 'events') {
        const entry = entryOf(kind, message.entry);
        if (entry === undefined) ignored += 1;
        else session.record(kind, entry);
        return;
      }
      ignored += 1;
    },
    /** The replay reached {@link MAX_REPLAY_BYTES}: the recording should end. */
    get full() {
      return full;
    },
    /** The epoch time the recording started, from the engine; none before its first replay event. */
    get startTs() {
      return startTs;
    },
    get ignored() {
      return ignored;
    },
    get environment() {
      return environment;
    },
    /** How many entries of each stream the engine's buffers dropped to stay within their limits. */
    dropped(stream: DiagnosticsStream): number {
      return session.dropped(stream);
    },
    get replayEvents() {
      return replayEvents;
    },
    /** Stops taking messages and closes the replay file. */
    close(): void {
      if (!fdOpen) return;
      fdOpen = false;
      closeSync(fd);
    },
    /**
     * The recording cut at `limitMs` from its start: the replay compressed into `gzipPath`, and
     * the streams redacted, timed from the start and compressed. Its length never exceeds the limit.
     */
    async output(limitMs: number, gzipPath: string): Promise<RecordingOutput> {
      if (startTs === undefined) throw new Error('nothing was recorded');
      const start = startTs;
      const end = start + Math.min(limitMs, capMs);
      let last = start;
      let count = 0;
      const kept = async function* () {
        const lines = createInterface({ input: createReadStream(replayPath), crlfDelay: Infinity });
        for await (const line of lines) {
          if (line === '') continue;
          const { timestamp } = JSON.parse(line) as { timestamp: number };
          if (timestamp > end) continue;
          last = Math.max(last, timestamp);
          count += 1;
          yield `${line}\n`;
        }
      };
      await pipeline(
        Readable.from(kept()),
        createGzip(),
        (await open(gzipPath, 'w')).createWriteStream(),
      );
      const durationMs = Math.max(1, Math.min(Math.round(last - start), end - start));
      const replayBytes = await open(gzipPath, 'r').then(async (handle) => {
        try {
          return (await handle.stat()).size;
        } finally {
          await handle.close();
        }
      });

      const streams: RecordedStream[] = [];
      for (const kind of STREAMS) {
        const entries: object[] = [];
        for (const entry of session.entries(kind)) {
          if (entry.ts < start || entry.ts > start + durationMs) continue;
          const out = redacted(kind, { ...entry, t: Math.round(entry.ts - start) });
          if (out !== null) entries.push(out);
        }
        if (entries.length === 0) continue;
        streams.push({ kind, count: entries.length, bytes: await gzipNdjson(entries) });
      }
      return { durationMs, replayPath: gzipPath, replayBytes, replayEvents: count, streams };
    },
  };
}

export type RecordingBuffer = ReturnType<typeof createRecordingBuffer>;
