/**
 * `@probara/node`: Probara error monitoring for Node.js. `init({ dsn })` once; uncaught exceptions
 * and unhandled rejections are then sent with breadcrumbs, source context and the runtime they
 * happened in. Importing it does nothing by itself.
 */
export {
  CLIENT_REPORT_INTERVAL_MS,
  DEFAULT_CLOSE_TIMEOUT_MS,
  DEFAULT_MAX_EVENTS_PER_MINUTE,
  SDK_NAME,
  addBreadcrumb,
  captureEvent,
  captureException,
  captureMessage,
  close,
  flush,
  getCurrentScope,
  getIsolationScope,
  init,
  lastEventId,
  setContext,
  setExtra,
  setExtras,
  setFingerprint,
  setLevel,
  setTag,
  setTags,
  setUser,
  withScope,
} from './sdk.js';
export type { NodeOptions } from './sdk.js';
export type { Transport, TransportFactory, TransportOptions } from './transport.js';
export { NEVER_CAPTURED_STATUSES } from './fetch.js';
export type { HttpErrorRules } from './fetch.js';
export { EXIT_FLUSH_TIMEOUT_MS } from './process.js';
export type { UncaughtExceptionMode, UnhandledRejectionMode } from './process.js';
export { probaraErrorHandler, probaraHono, probaraRequestHandler } from './middleware.js';
export type { ErrorHandlerOptions } from './middleware.js';
export { CONTEXT_LINES, MAX_SOURCE_FILE_BYTES } from './source.js';
export { VERSION } from './version.js';
export type {
  Breadcrumb,
  EventHint,
  ExceptionValue,
  Level,
  Mechanism,
  Pattern,
  ProbaraEvent,
  RequestInfo,
  Scope,
  ScopeData,
  StackFrame,
  TransportResponse,
  User,
} from '@probara/error-core';
