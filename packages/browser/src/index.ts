/**
 * `@probara/browser`: Probara error monitoring for the browser. `init({ dsn })` once; uncaught
 * errors and unhandled rejections are then sent with breadcrumbs, context and, when enabled, a
 * replay of the last minute. Importing it does nothing by itself.
 */
export {
  NEVER_CAPTURED_STATUSES,
  REPLAY_LOOKBACK_MS,
  SDK_NAME,
  addBreadcrumb,
  captureEvent,
  captureException,
  captureHttpError,
  captureMessage,
  close,
  flush,
  init,
  setContext,
  setExtra,
  setTag,
  setTags,
  setUser,
  withScope,
} from './sdk.js';
export type { BrowserOptions } from './sdk.js';
export { VERSION } from './version.js';
export type {
  Breadcrumb,
  EventHint,
  ExceptionValue,
  Level,
  Mechanism,
  Pattern,
  ProbaraEvent,
  Scope,
  ScopeData,
  StackFrame,
  User,
} from '@probara/error-core';
