/** Captured values turned into exception values: errors with their causes, and anything thrown. */
import { parseStackTrace } from './stack.js';
import type { ExceptionValue, Mechanism } from './types.js';

/** How many causes of an error are followed. */
export const MAX_EXCEPTION_CAUSES = 5;

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  cause?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  if (value instanceof Error) return true;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ErrorLike).message === 'string' &&
    (typeof (value as ErrorLike).stack === 'string' ||
      typeof (value as ErrorLike).name === 'string')
  );
}

function typeOf(error: ErrorLike): string {
  if (typeof error.name === 'string' && error.name !== '') return error.name;
  const constructor = (error as { constructor?: { name?: unknown } }).constructor;
  return typeof constructor?.name === 'string' && constructor.name !== ''
    ? constructor.name
    : 'Error';
}

function fromError(error: ErrorLike): ExceptionValue {
  const value: ExceptionValue = {
    type: typeOf(error),
    value: typeof error.message === 'string' ? error.message : '',
  };
  const frames = typeof error.stack === 'string' ? parseStackTrace(error.stack) : [];
  if (frames.length > 0) value.stacktrace = { frames };
  return value;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort().slice(0, 10);
    return keys.length === 0
      ? 'Object captured as exception'
      : `Object captured as exception with keys: ${keys.join(', ')}`;
  }
  return `Non-Error exception captured: ${String(value)}`;
}

/**
 * The exception values of `captured`: its causes first and `captured` itself last, which carries
 * `mechanism`. A value that is not an error becomes a synthetic `Error` describing it.
 */
export function exceptionValues(captured: unknown, mechanism: Mechanism): ExceptionValue[] {
  if (!isErrorLike(captured)) {
    return [
      { type: 'Error', value: describe(captured), mechanism: { ...mechanism, synthetic: true } },
    ];
  }
  const chain: ExceptionValue[] = [{ ...fromError(captured), mechanism }];
  const seen = new Set<unknown>([captured]);
  let cause = captured.cause;
  while (isErrorLike(cause) && !seen.has(cause) && chain.length <= MAX_EXCEPTION_CAUSES) {
    seen.add(cause);
    chain.unshift(fromError(cause));
    cause = cause.cause;
  }
  return chain;
}
