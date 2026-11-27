/**
 * The process's last resort: uncaught exceptions and unhandled promise rejections are captured, and
 * the process exits as Node would have, once the event had a chance to leave.
 */
import type { Mechanism } from '@probara/error-core';

/**
 * `exit`: capture, flush, then exit with code 1, as Node does without a listener; unless the app
 * listens to `uncaughtException` itself, then the app decides. `keep-alive`: capture and keep running.
 */
export type UncaughtExceptionMode = 'exit' | 'keep-alive';

/** `warn`: capture, warn and keep running. `strict`: capture, flush, then exit with code 1. */
export type UnhandledRejectionMode = 'warn' | 'strict';

/** How long the last events may take to leave before the process exits. */
export const EXIT_FLUSH_TIMEOUT_MS = 2000;

type Listener = (...args: unknown[]) => void;
type ProcessEvent = 'uncaughtException' | 'unhandledRejection';

/** The part of `process` the handlers use. */
export interface ProcessHost {
  on(event: ProcessEvent, listener: Listener): void;
  off(event: ProcessEvent, listener: Listener): void;
  listenerCount(event: ProcessEvent): number;
  exit(code: number): void;
}

export interface ProcessHooks {
  capture(error: unknown, mechanism: Mechanism, level: 'fatal' | 'error'): void;
  flush(timeoutMs: number): Promise<boolean>;
  log(message: string, error: unknown): void;
}

export interface ProcessModes {
  onUncaughtException: UncaughtExceptionMode;
  onUnhandledRejection: UnhandledRejectionMode;
}

/** Listens to the process's uncaught errors; returns what stops listening. */
export function installProcessHandlers(
  host: ProcessHost,
  hooks: ProcessHooks,
  modes: ProcessModes,
): () => void {
  let exiting = false;

  function exitAfterFlush(): void {
    if (exiting) {
      host.exit(1);
      return;
    }
    exiting = true;
    void hooks
      .flush(EXIT_FLUSH_TIMEOUT_MS)
      .catch(() => false)
      .then(() => {
        host.exit(1);
      });
  }

  const onUncaughtException: Listener = (error) => {
    hooks.capture(error, { type: 'onuncaughtexception', handled: false }, 'fatal');
    hooks.log('Uncaught exception:', error);
    if (modes.onUncaughtException === 'keep-alive') return;
    if (host.listenerCount('uncaughtException') > 1) return;
    exitAfterFlush();
  };

  const onUnhandledRejection: Listener = (reason) => {
    hooks.capture(reason, { type: 'onunhandledrejection', handled: false }, 'error');
    if (modes.onUnhandledRejection === 'strict') {
      hooks.log('Unhandled promise rejection:', reason);
      exitAfterFlush();
      return;
    }
    hooks.log(
      'Unhandled promise rejection, sent to Probara; the process keeps running (onUnhandledRejection: "warn"):',
      reason,
    );
  };

  host.on('uncaughtException', onUncaughtException);
  host.on('unhandledRejection', onUnhandledRejection);
  return () => {
    host.off('uncaughtException', onUncaughtException);
    host.off('unhandledRejection', onUnhandledRejection);
  };
}
