/**
 * The lines of the reporter, written through Vitest's logger. Every `[probara]` line goes to
 * stderr, as the Jest reporter's do: Vitest's warnings and errors go to stderr, its log to stdout,
 * and stdout belongs to the test framework and to its reporters (a JSON reporter on stdout must not
 * get a line of ours). So the info level goes out as a warning, plain text with the same prefix.
 */
import type { Logger } from '@probara/core';

/** Where Vitest's logger writes: `warn` and `error` both to stderr. */
export interface LogSink {
  warn(message: string): void;
  error(message: string): void;
}

const PREFIX = '[probara] ';

/** The reporter's logger over `sink`; debug lines only when `debug` is on. */
export function probaraLogger(sink: LogSink, debug: boolean): Logger {
  return {
    debug: (message) => {
      if (debug) sink.warn(`${PREFIX}${message}`);
    },
    info: (message) => {
      sink.warn(`${PREFIX}${message}`);
    },
    warn: (message) => {
      sink.warn(`${PREFIX}${message}`);
    },
    error: (message) => {
      sink.error(`${PREFIX}${message}`);
    },
  };
}
