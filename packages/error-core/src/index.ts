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
export type {
  Client,
  ClientOptions,
  ReplayProvider,
  ScopeIsolation,
  TransportResponse,
} from './client.js';
export { parseDsn } from './dsn.js';
export type { Dsn } from './dsn.js';
export { serializeEnvelope, utf8 } from './envelope.js';
export type { EnvelopeItem } from './envelope.js';
export { MAX_EXCEPTION_CAUSES, exceptionValues } from './exception.js';
export { DEFAULT_DENY_URLS, DEFAULT_IGNORE_ERRORS, matches } from './filters.js';
export type { Pattern } from './filters.js';
export { randomId } from './ids.js';
export { Scope } from './scope.js';
export type { ScopeData } from './scope.js';
export { MAX_STACK_FRAMES, isInApp, parseStackTrace } from './stack.js';
export type {
  Breadcrumb,
  EventHint,
  ExceptionValue,
  Level,
  Mechanism,
  Platform,
  ProbaraEvent,
  RequestInfo,
  StackFrame,
  User,
} from './types.js';
