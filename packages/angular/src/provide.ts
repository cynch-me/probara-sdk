/**
 * `provideProbara(options)`: starts `@probara/browser` when the app starts, sends what Angular's
 * ErrorHandler gets, tags events with their route, and hands `probaraHttpInterceptor` its rules.
 */
import {
  DestroyRef,
  ErrorHandler,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { ROUTES, Router } from '@angular/router';
import { init, type BrowserOptions } from '@probara/browser';
import { ProbaraErrorHandler } from './error-handler.js';
import { PROBARA_HTTP_ERRORS, type AngularHttpErrors } from './http.js';
import { watchRouter } from './router.js';

export interface ProbaraAngularOptions extends Omit<BrowserOptions, 'httpErrors'> {
  /** Logs each error to the console as Angular does: on unless false. */
  logErrors?: boolean;
  /**
   * HttpClient failures sent as events by `probaraHttpInterceptor`: HTTP 5xx are only breadcrumbs
   * unless their URL is one of `targets`; 400, 401 and 404 are never sent.
   */
  httpErrors?: AngularHttpErrors;
}

export function provideProbara(options: ProbaraAngularOptions): EnvironmentProviders {
  const { logErrors, httpErrors, ...browserOptions } = options;
  return makeEnvironmentProviders([
    {
      provide: ErrorHandler,
      useFactory: () => new ProbaraErrorHandler(logErrors === undefined ? {} : { logErrors }),
    },
    { provide: PROBARA_HTTP_ERRORS, useValue: httpErrors ?? null },
    provideAppInitializer(() => {
      init(browserOptions);
      if (inject(ROUTES, { optional: true }) === null) return;
      watchRouter(inject(Router), inject(DestroyRef));
    }),
  ]);
}
