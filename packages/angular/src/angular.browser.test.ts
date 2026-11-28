/**
 * The Angular integration in a real Chromium page, through a real Angular application: what
 * `@probara/browser` sends for errors Angular's ErrorHandler gets, router failures and routes, and
 * HttpClient failures.
 */
import '@angular/compiler';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { ErrorHandler, type ApplicationRef } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProbaraErrorHandler,
  close,
  flush,
  probaraHttpInterceptor,
  provideProbara,
  type ProbaraAngularOptions,
  type ProbaraEvent,
  VERSION,
} from './index.js';
import { VERSION as BROWSER_VERSION } from '@probara/browser';

const DSN = 'https://pek_angular@ingest.probara.test/';

let app: ApplicationRef | undefined;
let sent: ProbaraEvent[] = [];

afterEach(async () => {
  app?.destroy();
  app = undefined;
  sent = [];
  await close();
  vi.restoreAllMocks();
});

async function start(options: Partial<ProbaraAngularOptions> = {}) {
  app = await createApplication({
    providers: [
      provideProbara({
        dsn: DSN,
        beforeSend: (event) => {
          sent.push(event);
          return null;
        },
        ...options,
      }),
      provideRouter([
        { path: 'projects/:projectId/errors/:issueId', children: [] },
        { path: '', children: [] },
      ]),
      provideLocationMocks(),
      provideHttpClient(withInterceptors([probaraHttpInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  return app.injector;
}

describe('@probara/angular', () => {
  it("sends the errors Angular's ErrorHandler gets as unhandled, and logs them as Angular does", async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const injector = await start();
    const handler = injector.get(ErrorHandler);
    expect(handler).toBeInstanceOf(ProbaraErrorHandler);
    const error = new TypeError('cannot read total');
    handler.handleError(error);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.exception?.values.at(-1)).toMatchObject({
      type: 'TypeError',
      value: 'cannot read total',
      mechanism: { type: 'angular', handled: false },
    });
    expect(logged).toHaveBeenCalledWith('ERROR', error);
  });

  it('reports its own SDK name and version, listing the browser SDK it builds on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const injector = await start();
    injector.get(ErrorHandler).handleError(new Error('which sdk'));
    await flush();
    expect(sent[0]?.sdk).toEqual({
      name: 'probara.javascript.angular',
      version: VERSION,
      packages: [
        { name: 'npm:@probara/angular', version: VERSION },
        { name: 'npm:@probara/browser', version: BROWSER_VERSION },
      ],
    });
  });

  it('does not log when logErrors is false', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const injector = await start({ logErrors: false });
    injector.get(ErrorHandler).handleError(new Error('quiet'));
    await flush();
    expect(sent).toHaveLength(1);
    expect(logged).not.toHaveBeenCalled();
  });

  it('unwraps HTTP error responses, and never sends 400, 401 or 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const injector = await start();
    const handler = injector.get(ErrorHandler);
    for (const status of [400, 401, 404]) {
      handler.handleError(new HttpErrorResponse({ status, url: 'https://api.shop.test/x' }));
    }
    handler.handleError(
      new HttpErrorResponse({
        status: 500,
        url: 'https://api.shop.test/a',
        error: new Error('db down'),
      }),
    );
    handler.handleError(
      new HttpErrorResponse({ status: 502, url: 'https://api.shop.test/b', error: 'bad gateway' }),
    );
    handler.handleError('plain string failure');
    await flush();
    expect(sent.map((event) => event.exception?.values.at(-1)?.value)).toEqual([
      'db down',
      'Http failure response for https://api.shop.test/b: 502 bad gateway',
      'plain string failure',
    ]);
  });

  it("tags events with the route's path and keeps failed navigations as breadcrumbs", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const injector = await start();
    const router = injector.get(Router);
    await router.navigateByUrl('/projects/p1/errors/ERR-7');
    await router.navigateByUrl('/nowhere').catch(() => undefined);
    injector.get(ErrorHandler).handleError(new Error('after navigation'));
    await flush();
    const [event] = sent;
    expect(event?.tags?.['route']).toBe('/projects/:projectId/errors/:issueId');
    const failed = event?.breadcrumbs?.values.filter(
      (crumb) => crumb.category === 'angular.router',
    );
    expect(failed).toEqual([
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('/nowhere') as string,
      }),
    ]);
  });

  it('keeps router navigations as breadcrumbs with their route paths', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const injector = await start();
    const router = injector.get(Router);
    await router.navigateByUrl('/projects/p1/errors/ERR-7');
    await router.navigateByUrl('/');
    injector.get(ErrorHandler).handleError(new Error('after navigations'));
    await flush();
    const navigations = sent[0]?.breadcrumbs?.values
      .filter((crumb) => crumb.category === 'navigation' && crumb.type === 'navigation')
      .map((crumb) => [crumb.message, crumb.data]);
    expect(navigations?.slice(-2)).toEqual([
      ['/projects/p1/errors/ERR-7', { from: '/', to: '/projects/:projectId/errors/:issueId' }],
      ['/', { from: '/projects/:projectId/errors/:issueId', to: '/' }],
    ]);
  });

  it('sends HttpClient failures of the targets as events once, never 400, 401 or 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const injector = await start({
      httpErrors: { targets: ['https://api.shop.test/payments'], statuses: [[400, 599]] },
    });
    const http = injector.get(HttpClient);
    const backend = injector.get(HttpTestingController);
    const failures: unknown[] = [];
    const call = async (url: string, status: number) => {
      const pending = firstValueFrom(http.get(url)).catch((error: unknown) => failures.push(error));
      backend.expectOne(url).flush('down', { status, statusText: 'Failed' });
      await pending;
    };
    await call('https://api.shop.test/payments/1?token=secret-1', 503);
    await call('https://api.shop.test/payments/2', 404);
    await call('https://api.shop.test/cart', 503);
    const handler = injector.get(ErrorHandler);
    for (const failure of failures) handler.handleError(failure);
    await flush();
    const httpEvents = sent.filter(
      (event) => event.exception?.values.at(-1)?.mechanism?.type === 'angular.http',
    );
    expect(httpEvents).toHaveLength(1);
    expect(httpEvents[0]?.contexts?.['response']).toEqual({ status_code: 503 });
    expect(httpEvents[0]?.request?.method).toBe('GET');
    expect(httpEvents[0]?.request?.url).not.toContain('secret-1');
    expect(sent.map((event) => event.exception?.values.at(-1)?.mechanism?.type)).toEqual([
      'angular.http',
      'angular',
    ]);
  });
});
