/**
 * The user's sanitizers, then the built-in redaction. A sanitizer is synchronous: it returns the
 * (possibly modified) value to keep it, or `null` to drop it. It fails closed: when it throws or
 * returns anything else, the content it guarded is replaced with `SANITIZER_REDACTED`, never kept.
 */
import {
  isConsoleEntry,
  type ConsoleEntry,
  type NetworkBody,
  type NetworkEntry,
  type WebSocketDirection,
  type WebSocketMessageEntry,
} from './entries.js';
import { redactBody, redactHeaders, redactString } from './redact.js';

/** What replaces content a sanitizer failed on. */
export const SANITIZER_REDACTED = 'PROBARA_SANITIZER_REDACTED';

/** Gets each console entry; its `args`, `stack` and `source` are what it may change. */
export type LogSanitizer = (entry: ConsoleEntry) => ConsoleEntry | null;

export interface SanitizableRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The captured text of the body; `undefined` when none was captured. */
  body: string | undefined;
}

export interface SanitizableResponse {
  url: string;
  status: number | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface SanitizableWebSocketMessage {
  socketId: string;
  direction: WebSocketDirection;
  /** What it may change. */
  data: string;
}

export type RequestSanitizer = (request: SanitizableRequest) => SanitizableRequest | null;
export type ResponseSanitizer = (response: SanitizableResponse) => SanitizableResponse | null;
export type WebSocketSanitizer = (
  message: SanitizableWebSocketMessage,
) => SanitizableWebSocketMessage | null;

export interface Sanitizers {
  logSanitizer?: LogSanitizer;
  requestSanitizer?: RequestSanitizer;
  responseSanitizer?: ResponseSanitizer;
  webSocketSanitizer?: WebSocketSanitizer;
}

type Outcome<T> = { kind: 'keep'; value: T } | { kind: 'drop' } | { kind: 'fail' };

function run<T>(
  sanitizer: (value: T) => T | null,
  input: T,
  valid: (value: unknown) => value is T,
): Outcome<T> {
  try {
    const output = sanitizer(input);
    if (output === null) return { kind: 'drop' };
    return valid(output) ? { kind: 'keep', value: output } : { kind: 'fail' };
  } catch {
    return { kind: 'fail' };
  }
}

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null;

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isObject(value) && Object.values(value).every((inner) => typeof inner === 'string');

const isBodyText = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

function isRequest(value: unknown): value is SanitizableRequest {
  return (
    isObject(value) &&
    typeof value['url'] === 'string' &&
    typeof value['method'] === 'string' &&
    isStringRecord(value['headers']) &&
    isBodyText(value['body'])
  );
}

function isResponse(value: unknown): value is SanitizableResponse {
  return (
    isObject(value) &&
    typeof value['url'] === 'string' &&
    (value['status'] === undefined || typeof value['status'] === 'number') &&
    isStringRecord(value['headers']) &&
    isBodyText(value['body'])
  );
}

function isMessage(value: unknown): value is SanitizableWebSocketMessage {
  return isObject(value) && typeof value['data'] === 'string';
}

/** The console entry after `logSanitizer` and the built-in redaction; `null` when dropped. */
export function sanitizeConsoleEntry(
  entry: ConsoleEntry,
  logSanitizer?: LogSanitizer,
): ConsoleEntry | null {
  const { t, ts, level } = entry;
  let kept: ConsoleEntry = entry;
  if (logSanitizer !== undefined) {
    const outcome = run(logSanitizer, { ...entry, args: [...entry.args] }, isConsoleEntry);
    if (outcome.kind === 'drop') return null;
    if (outcome.kind === 'fail') return { t, ts, level, args: [SANITIZER_REDACTED] };
    kept = outcome.value;
  }
  const out: ConsoleEntry = { t, ts, level, args: kept.args.map(redactString) };
  if (kept.stack !== undefined) out.stack = redactString(kept.stack);
  if (kept.source !== undefined) out.source = redactString(kept.source);
  return out;
}

/** `body` with its text replaced by `text` (removed when `undefined`). */
function withText(
  body: NetworkBody | undefined,
  text: string | undefined,
): NetworkBody | undefined {
  if (body === undefined) {
    return text === undefined
      ? undefined
      : { text, truncated: false, size: new TextEncoder().encode(text).length };
  }
  const out: NetworkBody = { ...body };
  if (text === undefined) delete out.text;
  else out.text = text;
  return out;
}

function closedBody(body: NetworkBody | undefined): NetworkBody | undefined {
  return body === undefined
    ? undefined
    : { text: SANITIZER_REDACTED, truncated: false, size: body.size };
}

function setBody(
  entry: NetworkEntry,
  key: 'requestBody' | 'responseBody',
  body: NetworkBody | undefined,
): void {
  if (body !== undefined) entry[key] = body;
  else if (key === 'requestBody') delete entry.requestBody;
  else delete entry.responseBody;
}

/**
 * The network entry after `requestSanitizer`, `responseSanitizer` and the built-in redaction;
 * `null` when either sanitizer dropped it.
 */
export function sanitizeNetworkEntry(
  entry: NetworkEntry,
  sanitizers: Pick<Sanitizers, 'requestSanitizer' | 'responseSanitizer'> = {},
): NetworkEntry | null {
  const out: NetworkEntry = { ...entry };
  if (sanitizers.requestSanitizer !== undefined) {
    const outcome = run(
      sanitizers.requestSanitizer,
      {
        url: entry.url,
        method: entry.method,
        headers: { ...entry.requestHeaders },
        body: entry.requestBody?.text,
      },
      isRequest,
    );
    if (outcome.kind === 'drop') return null;
    if (outcome.kind === 'fail') {
      out.url = SANITIZER_REDACTED;
      out.requestHeaders = {};
      setBody(out, 'requestBody', closedBody(entry.requestBody));
      // The GraphQL operation is read from the request body.
      delete out.graphql;
    } else {
      out.url = outcome.value.url;
      out.method = outcome.value.method;
      out.requestHeaders = outcome.value.headers;
      setBody(out, 'requestBody', withText(entry.requestBody, outcome.value.body));
    }
  }
  if (sanitizers.responseSanitizer !== undefined) {
    const outcome = run(
      sanitizers.responseSanitizer,
      {
        url: out.url,
        status: entry.status,
        headers: { ...entry.responseHeaders },
        body: entry.responseBody?.text,
      },
      isResponse,
    );
    if (outcome.kind === 'drop') return null;
    if (outcome.kind === 'fail') {
      out.responseHeaders = {};
      setBody(out, 'responseBody', closedBody(entry.responseBody));
    } else {
      out.url = outcome.value.url;
      if (outcome.value.status === undefined) delete out.status;
      else out.status = outcome.value.status;
      out.responseHeaders = outcome.value.headers;
      setBody(out, 'responseBody', withText(entry.responseBody, outcome.value.body));
    }
  }
  out.url = redactString(out.url);
  out.requestHeaders = redactHeaders(out.requestHeaders);
  out.responseHeaders = redactHeaders(out.responseHeaders);
  for (const key of ['requestBody', 'responseBody'] as const) {
    const body = out[key];
    if (body?.text !== undefined) out[key] = { ...body, text: redactBody(body.text) };
  }
  if (out.error !== undefined) out.error = redactString(out.error);
  return out;
}

/** The WebSocket message after `webSocketSanitizer` and the built-in redaction; `null` when dropped. */
export function sanitizeWebSocketEntry(
  entry: WebSocketMessageEntry,
  webSocketSanitizer?: WebSocketSanitizer,
): WebSocketMessageEntry | null {
  let data = entry.data;
  if (webSocketSanitizer !== undefined) {
    const outcome = run(
      webSocketSanitizer,
      { socketId: entry.socketId, direction: entry.direction, data: entry.data },
      isMessage,
    );
    if (outcome.kind === 'drop') return null;
    data = outcome.kind === 'fail' ? SANITIZER_REDACTED : outcome.value.data;
  }
  return { ...entry, data: redactBody(data) };
}
