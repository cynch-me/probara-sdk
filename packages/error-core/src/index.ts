/**
 * `@probara/error-core`: the platform-neutral core of the Probara error monitoring SDKs. Private:
 * bundled into `@probara/browser` and `@probara/node`, never published or depended on.
 */
export {
  DEFAULT_MAX_BREADCRUMBS,
  DEFAULT_RETRY_AFTER_MS,
  RATE_LIMIT_EVENTS,
  RATE_LIMIT_WINDOW_MS,
  createClient,
} from './client.js';
export type { Client, ClientOptions, ReplayProvider, ScopeIsolation } from './client.js';
export {
  DEFAULT_RATE_LIMIT_MS,
  MAX_IN_FLIGHT_ENVELOPES,
  MAX_QUEUED_BYTES,
  MAX_QUEUED_ENVELOPES,
  MAX_SEND_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  createMemoryStore,
  parseRateLimits,
} from './transport.js';
export type {
  DataCategory,
  DiscardReason,
  DiscardedEvents,
  EnvelopeStore,
  Schedule,
  SendRequest,
  StoredEnvelope,
  TransportResponse,
} from './transport.js';
export { DEFAULT_NORMALIZE_DEPTH, normalize } from './normalize.js';
export { parseDsn } from './dsn.js';
export type { Dsn } from './dsn.js';
export { serializeEnvelope, utf8 } from './envelope.js';
export type { EnvelopeItem } from './envelope.js';
export { MAX_EXCEPTION_CAUSES, exceptionValues } from './exception.js';
export { DEFAULT_DENY_URLS, DEFAULT_IGNORE_ERRORS, matches } from './filters.js';
export type { Pattern } from './filters.js';
export { randomId } from './ids.js';
export { injectedRelease } from './release.js';
export { Scope } from './scope.js';
export type { ScopeData } from './scope.js';
export { MAX_STACK_FRAMES, isInApp, parseStackTrace } from './stack.js';
export type {
  Breadcrumb,
  DebugImage,
  EventHint,
  ExceptionValue,
  Level,
  Mechanism,
  Platform,
  ProbaraEvent,
  RequestInfo,
  SdkInfo,
  StackFrame,
  User,
} from './types.js';
