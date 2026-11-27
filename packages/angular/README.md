# @probara/angular

Error monitoring for Angular with [Probara](https://probara.net), on top of
[`@probara/browser`](../browser/README.md): the errors Angular's `ErrorHandler` gets are sent as
unhandled errors, each event carries the route it happened on, failed navigations become
breadcrumbs, and HttpClient failures of the URLs you choose are sent as events. It re-exports the
whole `@probara/browser` API (`captureException`, `setUser`, `withScope`…).

Requires Angular 19 or later.

## Install

```sh
npm install @probara/angular
```

## Start

Add `provideProbara` to your application's providers, with the DSN of your Probara project:

```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { probaraHttpInterceptor, provideProbara } from '@probara/angular';

bootstrapApplication(AppComponent, {
  providers: [
    provideProbara({
      dsn: 'https://<public key>@<probara api host>/',
      release: 'shop@2.4.0',
      environment: 'production',
      httpErrors: { targets: ['https://api.shop.example/payments'] },
    }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([probaraHttpInterceptor])),
  ],
});
```

`provideProbara` starts `@probara/browser` when the app starts (it takes every
[`@probara/browser` option](../browser/README.md#options)), and replaces Angular's `ErrorHandler`
with `ProbaraErrorHandler`. Call either `provideProbara` or `init`, not both.

## What is sent

- **Errors.** Everything Angular's `ErrorHandler` gets, as unhandled errors (`mechanism: angular`).
  The error is still logged to the console as Angular does (`ERROR …`); pass `logErrors: false` to
  stop that. For an `HttpErrorResponse`, the error behind it is sent, or
  `Http failure response for <url>: <status> <body>`; a 400, 401 or 404 response is never sent.
- **Routes.** Each event is tagged `route` with the path of the route it happened on, such as
  `/projects/:projectId/errors/:issueId`.
- **Navigations.** Failed navigations are `angular.router` breadcrumbs; the other navigations are
  breadcrumbs already, recorded by `@probara/browser` with the clicks, the console and every
  HttpClient request.
- **HttpClient failures.** With `probaraHttpInterceptor`, a failed response whose URL starts with
  one of `httpErrors.targets` (or matches a regular expression) and whose status is in
  `httpErrors.statuses` (500–599 unless given) is sent as an event, once: `ProbaraErrorHandler`
  leaves it out if it reaches it too. 400, 401 and 404 are never sent.

## Use your own ErrorHandler

`ProbaraErrorHandler` needs no injection: extend it, or create it yourself.

```ts
{ provide: ErrorHandler, useFactory: () => new ProbaraErrorHandler({ logErrors: false }) }
```

## License

Apache-2.0
