/**
 * The user's sanitizers, then the built-in redaction. A sanitizer is synchronous: it returns the
 * (possibly modified) value to keep it, or `null` to drop it. It fails closed: when it throws or
 * returns anything else (a Promise included), the content it guarded is replaced with
 * `SANITIZER_REDACTED`, never kept.
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

/** The most characters of a console entry's `stack` kept; a longer one ends with `…`. */
export const MAX_CONSOLE_STACK_LENGTH = 10_000;
/** The most characters of a console entry's `source` kept; a longer one ends with `…`. */
export const MAX_CONSOLE_SOURCE_LENGTH = 2_000;

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
    if (isThenable(output)) {
      // An async sanitizer: its result is never awaited, and its rejection is not left unhandled.
      output.then(undefined, () => undefined);
      return { kind: 'fail' };
    }
    return valid(output) ? { kind: 'keep', value: output } : { kind: 'fail' };
  } catch {
    return { kind: 'fail' };
  }
}

type Fields = Record<string, unknown>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' && value !== null && typeof (value as Fields)['then'] === 'function'
  );
}

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
  if (kept.stack !== undefined) out.stack = redactCapped(kept.stack, MAX_CONSOLE_STACK_LENGTH);
  if (kept.source !== undefined) out.source = redactCapped(kept.source, MAX_CONSOLE_SOURCE_LENGTH);
  return out;
}

/**
 * `text` redacted, then cut to `maxLength` characters ending with `…`. Only four times the limit
 * is redacted, so a huge text costs no more than a long one: a secret cut in two there lies past
 * the limit and is cut away too, unless the redaction before it shortened the text that much.
 */
function redactCapped(text: string, maxLength: number): string {
  const redacted = redactString(text.slice(0, maxLength * 4));
  if (redacted.length <= maxLength) return redacted;
  let end = maxLength - 1;
  // Never split a surrogate pair.
  const last = redacted.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${redacted.slice(0, end)}…`;
}

/**
 * `body` with its text replaced by `text` (removed when `undefined`). A body that was omitted
 * stays omitted: text a sanitizer supplies for it is ignored, since none was captured.
 */
function withText(body: NetworkBody | null, text: string | undefined): NetworkBody | null {
  if (body === null) {
    return text === undefined
      ? null
      : { text, truncated: false, size: new TextEncoder().encode(text).length, omitted: null };
  }
  if (body.omitted !== null) return { ...body, text: null };
  return { ...body, text: text ?? null };
}

/** What a body becomes when its sanitizer failed: its text replaced, an omitted body unchanged. */
function closedBody(body: NetworkBody | null): NetworkBody | null {
  if (body === null) return null;
  if (body.text === null) return { ...body };
  return { text: SANITIZER_REDACTED, truncated: false, size: body.size, omitted: null };
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
        body: entry.requestBody?.text ?? undefined,
      },
      isRequest,
    );
    if (outcome.kind === 'drop') return null;
    if (outcome.kind === 'fail') {
      out.url = SANITIZER_REDACTED;
      out.requestHeaders = {};
      out.requestBody = closedBody(entry.requestBody);
      // The GraphQL operation is read from the request body.
      out.graphql = null;
    } else {
      out.url = outcome.value.url;
      out.method = outcome.value.method;
      out.requestHeaders = outcome.value.headers;
      out.requestBody = withText(entry.requestBody, outcome.value.body);
    }
  }
  if (sanitizers.responseSanitizer !== undefined) {
    const outcome = run(
      sanitizers.responseSanitizer,
      {
        url: out.url,
        status: entry.status ?? undefined,
        headers: { ...entry.responseHeaders },
        body: entry.responseBody?.text ?? undefined,
      },
      isResponse,
    );
    if (outcome.kind === 'drop') return null;
    if (outcome.kind === 'fail') {
      out.responseHeaders = {};
      out.responseBody = closedBody(entry.responseBody);
    } else {
      out.url = outcome.value.url;
      out.status = outcome.value.status ?? null;
      out.responseHeaders = outcome.value.headers;
      out.responseBody = withText(entry.responseBody, outcome.value.body);
    }
  }
  out.url = redactString(out.url);
  out.requestHeaders = redactHeaders(out.requestHeaders);
  out.responseHeaders = redactHeaders(out.responseHeaders);
  for (const key of ['requestBody', 'responseBody'] as const) {
    const body = out[key];
    if (body != null && body.text !== null) out[key] = { ...body, text: redactBody(body.text) };
  }
  if (out.error !== null) out.error = redactString(out.error);
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
