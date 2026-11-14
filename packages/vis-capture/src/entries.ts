/**
 * The diagnostics format of a Vis: one JSON document per line (NDJSON), gzip-compressed, one file
 * per stream (console, network, events). Every entry carries `t`, the milliseconds since the
 * recording started, and `ts`, the epoch milliseconds when it happened.
 */

/** The version of the entry shapes below; it changes when one of them does. */
export const DIAGNOSTICS_FORMAT_VERSION = 1;

/** The time fields every entry carries. */
export interface EntryTime {
  /** Milliseconds since the recording started. */
  t: number;
  /** Epoch milliseconds. */
  ts: number;
}

export const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

/** A console call, an uncaught error or an unhandled rejection of the page. */
export interface ConsoleEntry extends EntryTime {
  level: ConsoleLevel;
  /** Each argument, serialized (`serializeArgument`). */
  args: string[];
  /** The stack trace, from the caller of the console or of the error. */
  stack?: string;
  /** Where an uncaught error was thrown: `<url>:<line>:<column>`. */
  source?: string;
}

export const NETWORK_KINDS = ['fetch', 'xhr', 'beacon', 'resource', 'websocket'] as const;
export type NetworkKind = (typeof NETWORK_KINDS)[number];

/** Why a body was not captured. */
export type BodyOmittedReason = 'too_large' | 'binary' | 'stream' | 'opaque' | 'unsupported';

/**
 * A request or response body. Every field is present: `null` stands for "no value", as the
 * Probara API's schema requires.
 */
export interface NetworkBody {
  /** The text kept; `null` when the body was not kept. */
  text: string | null;
  /** `text` holds only the start of the body. */
  truncated: boolean;
  /** The size of the whole body in bytes; `null` when unknown. */
  size: number | null;
  /** Why the body was not kept; `null` when it was. Never set together with `text`. */
  omitted: BodyOmittedReason | null;
}

/** Phases of a request, in milliseconds, when the browser exposes them. */
export interface NetworkTiming {
  startMs?: number;
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  ttfbMs?: number;
  responseMs?: number;
}

export const GRAPHQL_OPERATION_TYPES = ['query', 'mutation', 'subscription'] as const;
export type GraphqlOperationType = (typeof GRAPHQL_OPERATION_TYPES)[number];

export interface GraphqlInfo {
  /** `null` when the request does not name its operation. */
  operationName: string | null;
  /** `null` when the request carries no query text (a persisted query). */
  operationType: GraphqlOperationType | null;
  /** The response holds `errors`, whatever its HTTP status. */
  hasErrors: boolean;
}

/**
 * One request, or one WebSocket (`kind: 'websocket'`). Every field is present: `null` stands for
 * "no value", as the Probara API's schema requires.
 */
export interface NetworkEntry extends EntryTime {
  id: string;
  kind: NetworkKind;
  method: string;
  url: string;
  /** `null` when no response arrived (a network error, an abort). */
  status: number | null;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: NetworkBody | null;
  responseBody: NetworkBody | null;
  durationMs: number | null;
  timing: NetworkTiming | null;
  error: string | null;
  graphql: GraphqlInfo | null;
}

export type WebSocketDirection = 'sent' | 'received';

/** One message on a WebSocket, linked to its opening entry by `socketId` (its `id`). */
export interface WebSocketMessageEntry extends EntryTime {
  socketId: string;
  direction: WebSocketDirection;
  data: string;
}

export const USER_EVENT_TYPES = [
  'click',
  'input',
  'navigation',
  'keypress',
  'scroll',
  'resize',
  'visibility',
] as const;
export type UserEventType = (typeof USER_EVENT_TYPES)[number];

export interface UserEventTarget {
  selector?: string;
  text?: string;
  tag?: string;
}

export interface UserEventEntry extends EntryTime {
  type: UserEventType;
  target?: UserEventTarget | null;
  url: string;
  /** The typed value, masked; for a keypress, the key or shortcut (`Control+s`). */
  value?: string;
  x?: number;
  y?: number;
}

export type DiagnosticsEntry = ConsoleEntry | NetworkEntry | WebSocketMessageEntry | UserEventEntry;

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** `key` is present and holds `null` or a value `check` accepts. */
function nullable(fields: Fields, key: string, check: (value: unknown) => boolean): boolean {
  return key in fields && (fields[key] === null || check(fields[key]));
}

/** `key` is absent, or holds a value `check` accepts. */
function optional(fields: Fields, key: string, check: (value: unknown) => boolean): boolean {
  return !(key in fields) || fields[key] === undefined || check(fields[key]);
}

const isString = (value: unknown): value is string => typeof value === 'string';

function oneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every(isString);
}

function hasTime(value: unknown): value is Fields {
  return isObject(value) && isFiniteNumber(value['t']) && isFiniteNumber(value['ts']);
}

function isNetworkBody(value: unknown): value is NetworkBody {
  return (
    isObject(value) &&
    typeof value['truncated'] === 'boolean' &&
    nullable(value, 'size', isFiniteNumber) &&
    nullable(value, 'text', isString) &&
    nullable(value, 'omitted', isString)
  );
}

function isGraphqlInfo(value: unknown): value is GraphqlInfo {
  return (
    isObject(value) &&
    typeof value['hasErrors'] === 'boolean' &&
    nullable(value, 'operationName', isString) &&
    nullable(value, 'operationType', oneOf(GRAPHQL_OPERATION_TYPES))
  );
}

function isTiming(value: unknown): value is NetworkTiming {
  return isObject(value) && Object.values(value).every(isFiniteNumber);
}

export function isConsoleEntry(value: unknown): value is ConsoleEntry {
  return (
    hasTime(value) &&
    oneOf(CONSOLE_LEVELS)(value['level']) &&
    Array.isArray(value['args']) &&
    value['args'].every(isString) &&
    optional(value, 'stack', isString) &&
    optional(value, 'source', isString)
  );
}

export function isNetworkEntry(value: unknown): value is NetworkEntry {
  return (
    hasTime(value) &&
    isString(value['id']) &&
    oneOf(NETWORK_KINDS)(value['kind']) &&
    isString(value['method']) &&
    isString(value['url']) &&
    isStringRecord(value['requestHeaders']) &&
    isStringRecord(value['responseHeaders']) &&
    nullable(value, 'status', isFiniteNumber) &&
    nullable(value, 'requestBody', isNetworkBody) &&
    nullable(value, 'responseBody', isNetworkBody) &&
    nullable(value, 'durationMs', isFiniteNumber) &&
    nullable(value, 'timing', isTiming) &&
    nullable(value, 'error', isString) &&
    nullable(value, 'graphql', isGraphqlInfo)
  );
}

export function isWebSocketMessageEntry(value: unknown): value is WebSocketMessageEntry {
  return (
    hasTime(value) &&
    isString(value['socketId']) &&
    oneOf(['sent', 'received'])(value['direction']) &&
    isString(value['data'])
  );
}

function isUserEventTarget(value: unknown): value is UserEventTarget {
  return (
    isObject(value) &&
    optional(value, 'selector', isString) &&
    optional(value, 'text', isString) &&
    optional(value, 'tag', isString)
  );
}

export function isUserEventEntry(value: unknown): value is UserEventEntry {
  return (
    hasTime(value) &&
    oneOf(USER_EVENT_TYPES)(value['type']) &&
    isString(value['url']) &&
    (value['target'] === null || optional(value, 'target', isUserEventTarget)) &&
    optional(value, 'value', isString) &&
    optional(value, 'x', isFiniteNumber) &&
    optional(value, 'y', isFiniteNumber)
  );
}
