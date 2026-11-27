/** What Angular hands its ErrorHandler, turned into what is worth sending. */
import { HttpErrorResponse } from '@angular/common/http';
import { NEVER_CAPTURED_STATUSES } from '@probara/browser';

/** HTTP error responses already sent by `probaraHttpInterceptor`. */
const reported = new WeakSet<object>();

export function markReported(error: object): void {
  reported.add(error);
}

/** Whether the ErrorHandler leaves `error` out: sent already, or a 400, 401 or 404 response. */
export function isSkipped(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (reported.has(error)) return true;
  return error instanceof HttpErrorResponse && NEVER_CAPTURED_STATUSES.includes(error.status);
}

function httpFailure(response: HttpErrorResponse): unknown {
  const body: unknown = response.error;
  if (body instanceof Error) return body;
  const head = `Http failure response for ${response.url ?? '(unknown url)'}: ${String(response.status)}`;
  if (typeof ErrorEvent !== 'undefined' && body instanceof ErrorEvent && body.message !== '')
    return `${head} ${body.message}`;
  if (typeof body === 'string' && body !== '') return `${head} ${body}`;
  return head;
}

/** The error worth sending: the original of a wrapped error, the cause of an HTTP failure. */
export function extractError(error: unknown): unknown {
  let current = error;
  if (typeof current === 'object' && current !== null && 'ngOriginalError' in current) {
    const original = current.ngOriginalError;
    if (original !== undefined && original !== null) current = original;
  }
  return current instanceof HttpErrorResponse ? httpFailure(current) : current;
}
