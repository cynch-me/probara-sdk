/**
 * The HttpClient interceptor: failed responses of the URLs `httpErrors` names are sent as events,
 * and the ErrorHandler then leaves them out. Every request is already a breadcrumb: the browser SDK
 * records the fetch or XHR request underneath, so the interceptor adds none.
 */
import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpRequest,
} from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';
import { captureHttpError } from '@probara/browser';
import { tap, type Observable } from 'rxjs';
import { markReported } from './errors.js';

export interface AngularHttpErrors {
  /** URLs whose failed responses are sent as events: prefixes or regular expressions. */
  targets: readonly (string | RegExp)[];
  /** Statuses or ranges sent: 500–599 unless given. 400, 401 and 404 never are. */
  statuses?: readonly (number | readonly [number, number])[];
}

export const PROBARA_HTTP_ERRORS = new InjectionToken<AngularHttpErrors | null>(
  'PROBARA_HTTP_ERRORS',
);

function isTarget(url: string, targets: readonly (string | RegExp)[]): boolean {
  return targets.some((target) => {
    if (typeof target === 'string') return url.startsWith(target);
    target.lastIndex = 0;
    return target.test(url);
  });
}

function statusMatches(
  status: number,
  statuses: readonly (number | readonly [number, number])[],
): boolean {
  return statuses.some((rule) =>
    typeof rule === 'number' ? rule === status : status >= rule[0] && status <= rule[1],
  );
}

/** `provideHttpClient(withInterceptors([probaraHttpInterceptor]))`. */
export function probaraHttpInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const rules = inject(PROBARA_HTTP_ERRORS, { optional: true });
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (rules === null || !(error instanceof HttpErrorResponse)) return;
        const url = error.url ?? request.urlWithParams;
        if (!statusMatches(error.status, rules.statuses ?? [[500, 599]])) return;
        if (!isTarget(url, rules.targets)) return;
        const id = captureHttpError(
          { url, method: request.method, status: error.status },
          'angular.http',
        );
        if (id !== '') markReported(error);
      },
    }),
  );
}
