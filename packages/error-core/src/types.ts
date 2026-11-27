/**
 * The event the Probara error ingest reads: Sentry's field names (snake_case), with Probara's
 * platforms and an opaque user only.
 */

export type Level = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export type Platform = 'browser' | 'node';

export interface StackFrame {
  filename?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  /** The absolute path of the file, when `filename` is shortened. */
  abs_path?: string;
  /** The source lines before the frame's line, its line, and the lines after it. */
  pre_context?: string[];
  context_line?: string;
  post_context?: string[];
}

export interface Mechanism {
  /** How the error was caught: `generic` for `captureException`, `onerror`, `onunhandledrejection`… */
  type: string;
  /** `false` when nothing in the app caught it. */
  handled?: boolean;
  /** The exception was made up from a value that is not an error. */
  synthetic?: boolean;
  data?: Record<string, unknown>;
}

export interface ExceptionValue {
  type?: string;
  value?: string;
  mechanism?: Mechanism;
  stacktrace?: { frames: StackFrame[] };
}

export interface Breadcrumb {
  /** Seconds since the epoch; set when added unless given. */
  timestamp?: number;
  type?: string;
  category?: string;
  message?: string;
  level?: Level;
  data?: Record<string, unknown>;
}

/** Only opaque identifiers: no email, no IP address. */
export interface User {
  id?: string;
  username?: string;
  segment?: string;
}

export interface RequestInfo {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

export interface ProbaraEvent {
  event_id?: string;
  /** Seconds since the epoch. */
  timestamp?: number;
  platform?: Platform;
  /** The host the event happened on (Node). */
  server_name?: string;
  level?: Level;
  release?: string;
  environment?: string;
  message?: string;
  exception?: { values: ExceptionValue[] };
  breadcrumbs?: { values: Breadcrumb[] };
  tags?: Record<string, string>;
  contexts?: Record<string, Record<string, unknown>>;
  user?: User;
  request?: RequestInfo;
  sdk?: { name: string; version: string };
  extra?: Record<string, unknown>;
  fingerprint?: string[];
  /** The source maps of the files the frames are in, by the debug IDs injected into them. */
  debug_meta?: { images: DebugImage[] };
}

/** A file built with a source map: its frames are symbolicated with the map of `debug_id`. */
export interface DebugImage {
  type: 'sourcemap';
  /** The file name the frames carry. */
  code_file: string;
  debug_id: string;
}

/** What came with an event: the value captured and how it was caught. */
export interface EventHint {
  originalException?: unknown;
  mechanism?: Mechanism;
}
