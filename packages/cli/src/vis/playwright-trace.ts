/**
 * A Playwright trace archive (`trace.zip`) as the diagnostics of a Vis: its console messages and
 * page errors as the `console` stream, its network log (HAR entries, with the bodies the archive
 * holds) as the `network` stream, and the actions of the test (clicks, fills, key presses,
 * navigations) as the `events` stream. Every line is timed from the start of the video, which
 * Playwright starts when the page is created, and goes through the redaction of
 * `@probara/vis-capture` before it leaves the machine.
 */
import {
  DEFAULT_BODY_LIMITS,
  graphqlHasErrors,
  graphqlOperation,
  redactString,
  sanitizeConsoleEntry,
  sanitizeNetworkEntry,
  type ConsoleEntry,
  type ConsoleLevel,
  type NetworkBody,
  type NetworkEntry,
  type NetworkKind,
  type NetworkTiming,
  type UserEventEntry,
  type UserEventType,
} from '@probara/vis-capture';
import { readZip, ZipError, type ZipArchive } from './zip.js';

/** A trace that cannot be read; the message says what was unreadable. */
export class TraceError extends Error {
  override readonly name = 'TraceError';
}

export interface TraceDiagnostics {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  events: UserEventEntry[];
}

type Line = Record<string, unknown>;

/** One context of the trace: its clock and its lines. */
interface Context {
  /** Epoch ms at `monotonicTime`. */
  wallTime: number;
  /** The monotonic ms every `time` of the context is on. */
  monotonicTime: number;
  lines: Line[];
  network: Line[];
}

const CONSOLE_LEVELS: Readonly<Record<string, ConsoleLevel>> = {
  debug: 'debug',
  log: 'log',
  info: 'info',
  warning: 'warn',
  warn: 'warn',
  error: 'error',
  assert: 'error',
  trace: 'trace',
};

const CLICKS = new Set(['click', 'dblclick', 'tap', 'check', 'uncheck', 'setChecked']);
const INPUTS = new Set(['fill', 'type', 'pressSequentially', 'selectOption', 'setInputFiles']);
const KEYS = new Set(['press']);
const NAVIGATIONS = new Set(['goto', 'goBack', 'goForward', 'reload']);
/** A field whose value is never recorded, not even masked: it holds a secret. */
const SECRET_FIELD = /pass|pwd|secret|token|otp|pin\b|cvv|cvc|card/i;
/** The longest masked value: one `*` per character, as the capture engine masks a typed value. */
const MAX_MASKED_LENGTH = 100;
/** Text a body is kept as, from its MIME type. */
const TEXT_TYPE =
  /^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|x-www-form-urlencoded|graphql|x-ndjson)\b)/i;
const NAVIGATED = /navigated to "(.+)"$/;

function isRecord(value: unknown): value is Line {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseLines(archive: ZipArchive, name: string): Line[] {
  const bytes = archive.read(name);
  if (bytes === undefined) return [];
  const lines: Line[] = [];
  bytes
    .toString('utf8')
    .split('\n')
    .forEach((text, index) => {
      if (text.trim() === '') return;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new TraceError(`line ${String(index + 1)} of ${name} is not JSON`);
      }
      if (isRecord(value)) lines.push(value);
    });
  return lines;
}

/** The contexts of the archive: `trace.trace`, `1-trace.trace`... with their network logs. */
function contextsOf(archive: ZipArchive): Context[] {
  const traces = archive
    .names()
    .filter((name) => /(?:^|\/)(?:\d+-)?trace\.trace$/.test(name))
    .sort();
  if (traces.length === 0) {
    throw new TraceError('holds no trace.trace file, so it is not a Playwright trace');
  }
  return traces.map((name) => {
    const lines = parseLines(archive, name);
    const options = lines.find((line) => line.type === 'context-options');
    const wallTime = numberOf(options?.wallTime);
    const monotonicTime = numberOf(options?.monotonicTime);
    if (wallTime === undefined || monotonicTime === undefined) {
      throw new TraceError(`${name} does not start with the context of the trace`);
    }
    const network = parseLines(archive, name.replace(/\.trace$/, '.network'));
    return { wallTime, monotonicTime, lines, network };
  });
}

/** Epoch ms of a monotonic `time` of `context`. */
function wallOf(context: Context, time: number): number {
  return context.wallTime + (time - context.monotonicTime);
}

/** The headers of a HAR list as one record; a repeated name joins its values with commas. */
function headersOf(list: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!Array.isArray(list)) return headers;
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = stringOf(item.name);
    const value = stringOf(item.value);
    if (name === undefined || value === undefined) continue;
    headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  return headers;
}

/** The bytes of a HAR body: inline text, or the resource file of the archive it names. */
function bodyBytesOf(archive: ZipArchive, body: Line): Buffer | undefined {
  const file =
    stringOf(body._file) ??
    (stringOf(body._sha1) === undefined ? undefined : `resources/${String(body._sha1)}`);
  if (file !== undefined) {
    const bytes = archive.read(file);
    if (bytes !== undefined) return bytes;
  }
  const text = stringOf(body.text);
  if (text === undefined || text === '') return undefined;
  return body.encoding === 'base64' ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
}

/** A body as the diagnostics format keeps it: text up to the capture engine's limit, or why not. */
function networkBodyOf(archive: ZipArchive, body: unknown): NetworkBody | null {
  if (!isRecord(body)) return null;
  const bytes = bodyBytesOf(archive, body);
  if (bytes === undefined) return null;
  const mimeType = stringOf(body.mimeType) ?? '';
  if (mimeType !== '' && !TEXT_TYPE.test(mimeType)) {
    return { text: null, truncated: false, size: bytes.length, omitted: 'binary' };
  }
  const limit = DEFAULT_BODY_LIMITS.maxBodyBytes;
  const truncated = bytes.length > limit;
  const text = (truncated ? bytes.subarray(0, limit) : bytes).toString('utf8');
  return { text, truncated, size: bytes.length, omitted: null };
}

function kindOf(resourceType: unknown): NetworkKind {
  switch (resourceType) {
    case 'fetch':
      return 'fetch';
    case 'xhr':
      return 'xhr';
    case 'websocket':
      return 'websocket';
    case 'ping':
      return 'beacon';
    default:
      return 'resource';
  }
}

function timingOf(timings: unknown): NetworkTiming | null {
  if (!isRecord(timings)) return null;
  const timing: NetworkTiming = {};
  const phases: [keyof NetworkTiming, string][] = [
    ['dnsMs', 'dns'],
    ['connectMs', 'connect'],
    ['tlsMs', 'ssl'],
    ['ttfbMs', 'wait'],
    ['responseMs', 'receive'],
  ];
  for (const [field, phase] of phases) {
    const value = numberOf(timings[phase]);
    if (value !== undefined && value >= 0) timing[field] = value;
  }
  return Object.keys(timing).length === 0 ? null : timing;
}

interface Timed<T> {
  wall: number;
  entry: (t: number, ts: number) => T;
}

function networkOf(
  archive: ZipArchive,
  context: Context,
  index: { next: number },
): Timed<NetworkEntry>[] {
  const out: Timed<NetworkEntry>[] = [];
  for (const line of context.network) {
    if (line.type !== 'resource-snapshot' || !isRecord(line.snapshot)) continue;
    const snapshot = line.snapshot;
    const request = isRecord(snapshot.request) ? snapshot.request : {};
    const response = isRecord(snapshot.response) ? snapshot.response : {};
    const url = stringOf(request.url);
    if (url === undefined) continue;
    const monotonic = numberOf(snapshot._monotonicTime);
    const started = Date.parse(stringOf(snapshot.startedDateTime) ?? '');
    const wall = monotonic !== undefined ? wallOf(context, monotonic) : started;
    if (!Number.isFinite(wall)) continue;
    const status = numberOf(response.status);
    const requestHeaders = headersOf(request.headers);
    const requestBody = networkBodyOf(archive, request.postData);
    const responseBody = networkBodyOf(archive, response.content);
    const contentType =
      Object.entries(requestHeaders).find(([name]) => name.toLowerCase() === 'content-type')?.[1] ??
      null;
    const method = stringOf(request.method) ?? 'GET';
    const operation = graphqlOperation({
      method,
      url,
      contentType,
      body: requestBody?.text ?? null,
    });
    index.next += 1;
    const id = `r${String(index.next)}`;
    const duration = numberOf(snapshot.time);
    out.push({
      wall,
      entry: (t, ts) => ({
        t,
        ts,
        id,
        kind: kindOf(snapshot._resourceType),
        method,
        url,
        status: status === undefined || status <= 0 ? null : status,
        requestHeaders,
        responseHeaders: headersOf(response.headers),
        requestBody,
        responseBody,
        durationMs: duration === undefined || duration < 0 ? null : duration,
        timing: timingOf(snapshot.timings),
        error: stringOf(response._failureText) ?? null,
        graphql:
          operation === null
            ? null
            : { ...operation, hasErrors: graphqlHasErrors(responseBody?.text ?? null) },
      }),
    });
  }
  return out;
}

function consoleOf(context: Context): Timed<ConsoleEntry>[] {
  const out: Timed<ConsoleEntry>[] = [];
  for (const line of context.lines) {
    const time = numberOf(line.time);
    if (time === undefined) continue;
    if (line.type === 'console') {
      const type = stringOf(line.messageType) ?? 'log';
      const args = Array.isArray(line.args)
        ? line.args.flatMap((arg) => {
            if (!isRecord(arg)) return [];
            const text = stringOf(arg.preview) ?? stringOf(arg.value);
            return text === undefined ? [] : [text];
          })
        : [];
      const location = isRecord(line.location) ? line.location : {};
      const url = stringOf(location.url);
      const lineNumber = numberOf(location.lineNumber);
      out.push({
        wall: wallOf(context, time),
        entry: (t, ts) => ({
          t,
          ts,
          level: CONSOLE_LEVELS[type] ?? 'log',
          args: args.length > 0 ? args : [stringOf(line.text) ?? ''],
          ...(url === undefined || url === ''
            ? {}
            : { source: lineNumber === undefined ? url : `${url}:${String(lineNumber + 1)}` }),
        }),
      });
    } else if (line.type === 'event' && line.method === 'pageError' && isRecord(line.params)) {
      const outer = isRecord(line.params.error) ? line.params.error : {};
      const error = isRecord(outer.error) ? outer.error : outer;
      const message = stringOf(error.message) ?? 'Uncaught error';
      const stack = stringOf(error.stack);
      out.push({
        wall: wallOf(context, time),
        entry: (t, ts) => ({
          t,
          ts,
          level: 'error',
          args: [message],
          ...(stack === undefined ? {} : { stack }),
        }),
      });
    }
  }
  return out;
}

function masked(value: string): string {
  return '*'.repeat(Math.min(Array.from(value).length, MAX_MASKED_LENGTH));
}

function eventsOf(context: Context, url: { current: string }): Timed<UserEventEntry>[] {
  const out: Timed<UserEventEntry>[] = [];
  const points = new Map<string, { x: number; y: number }>();
  for (const line of context.lines) {
    if (line.type !== 'input' || !isRecord(line.point)) continue;
    const x = numberOf(line.point.x);
    const y = numberOf(line.point.y);
    const callId = stringOf(line.callId);
    if (callId !== undefined && x !== undefined && y !== undefined) points.set(callId, { x, y });
  }
  const push = (wall: number, type: UserEventType, fields: Partial<UserEventEntry>) => {
    const at = url.current;
    out.push({ wall, entry: (t, ts) => ({ t, ts, type, url: at, ...fields }) });
  };
  for (const line of context.lines) {
    if (line.type === 'log') {
      const time = numberOf(line.time);
      const navigated = NAVIGATED.exec(stringOf(line.message) ?? '')?.[1];
      if (time !== undefined && navigated !== undefined && navigated !== url.current) {
        url.current = navigated;
        push(wallOf(context, time), 'navigation', {});
      }
      continue;
    }
    if (line.type !== 'before') continue;
    const method = stringOf(line.method) ?? '';
    const time = numberOf(line.startTime);
    if (time === undefined) continue;
    const wall = wallOf(context, time);
    const params = isRecord(line.params) ? line.params : {};
    const selector = stringOf(params.selector);
    const target = selector === undefined ? {} : { target: { selector } };
    if (NAVIGATIONS.has(method)) {
      const next = stringOf(params.url);
      if (next !== undefined) url.current = next;
      push(wall, 'navigation', {});
    } else if (CLICKS.has(method)) {
      const point = points.get(stringOf(line.callId) ?? '');
      push(wall, 'click', { ...target, ...(point === undefined ? {} : point) });
    } else if (INPUTS.has(method)) {
      const value = stringOf(params.value) ?? stringOf(params.text);
      const secret = selector !== undefined && SECRET_FIELD.test(selector);
      push(wall, 'input', {
        ...target,
        ...(value === undefined || secret ? {} : { value: masked(value) }),
      });
    } else if (KEYS.has(method)) {
      const key = stringOf(params.key);
      // A named key (Enter, Tab) says what happened; a character is typed text, masked.
      const named = key !== undefined && /^[A-Z][A-Za-z0-9+]+$/.test(key);
      push(wall, 'keypress', {
        ...target,
        ...(key === undefined ? {} : { value: named ? key : masked(key) }),
      });
    }
  }
  return out;
}

/** When the video starts: the creation of the first page, else the start of the trace. */
function originOf(contexts: readonly Context[]): number {
  let origin: number | undefined;
  for (const context of contexts) {
    for (const line of context.lines) {
      const time = numberOf(line.time);
      if (line.type === 'event' && line.method === 'page' && time !== undefined) {
        const wall = wallOf(context, time);
        if (origin === undefined || wall < origin) origin = wall;
      }
    }
  }
  return origin ?? Math.min(...contexts.map((context) => context.wallTime));
}

/** The entries in time order, timed from `origin` (never before it). */
function timed<T>(items: readonly Timed<T>[], origin: number): T[] {
  return [...items]
    .sort((a, b) => a.wall - b.wall)
    .map(({ wall, entry }) =>
      entry(Math.max(0, Math.round((wall - origin) * 10) / 10), Math.round(wall)),
    );
}

/**
 * The diagnostics of a Playwright trace archive, redacted.
 *
 * @throws TraceError when the archive or one of its trace files cannot be read.
 */
export function readPlaywrightTrace(archive: Buffer): TraceDiagnostics {
  let zip: ZipArchive;
  try {
    zip = readZip(archive);
  } catch (error) {
    if (error instanceof ZipError) throw new TraceError(error.message);
    throw error;
  }
  try {
    const contexts = contextsOf(zip);
    const origin = originOf(contexts);
    const index = { next: 0 };
    const url = { current: 'about:blank' };
    const consoleEntries = timed(contexts.flatMap(consoleOf), origin);
    const network = timed(
      contexts.flatMap((context) => networkOf(zip, context, index)),
      origin,
    );
    const events = timed(
      contexts.flatMap((context) => eventsOf(context, url)),
      origin,
    );
    return {
      console: consoleEntries.flatMap((entry) => sanitizeConsoleEntry(entry) ?? []),
      network: network.flatMap((entry) => sanitizeNetworkEntry(entry) ?? []),
      events: events.map(redactEvent),
    };
  } catch (error) {
    if (error instanceof ZipError) throw new TraceError(error.message);
    throw error;
  }
}

/** A user event with the secrets of its page URL and its target redacted. */
/** A user event with its URL and target text redacted; `vis record` redacts the page's the same way. */
export function redactEvent(event: UserEventEntry): UserEventEntry {
  const out: UserEventEntry = { ...event, url: redactString(event.url) };
  if (event.target != null) {
    out.target = Object.fromEntries(
      Object.entries(event.target).map(([key, value]) => [key, redactString(String(value))]),
    );
  }
  return out;
}
