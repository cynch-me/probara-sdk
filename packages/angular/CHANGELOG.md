# @probara/angular

## 0.1.0

### Minor Changes

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`2bd3c8a`](https://github.com/cynch-me/probara-sdk/commit/2bd3c8ab892604a2254b4edd61e717991f630242) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New package: `@probara/angular`, error monitoring for Angular 19 and later on top of
  `@probara/browser`, whose API it re-exports. `provideProbara({ dsn })` starts the browser SDK when
  the app starts and installs `ProbaraErrorHandler`, which sends what Angular's `ErrorHandler` gets
  as unhandled errors (the error behind an `HttpErrorResponse`, never a 400, 401 or 404) and still
  logs it unless `logErrors: false`. Events are tagged with their route's path, failed navigations
  are breadcrumbs, and `probaraHttpInterceptor` sends HttpClient failures of `httpErrors.targets` as
  events, once.

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`8a61a6c`](https://github.com/cynch-me/probara-sdk/commit/8a61a6ca6208cddb064819a8df88340a43642bd1) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New options, as in Sentry's SDKs: `enabled`, `debug`, `dist`, `tunnel`, a custom `transport`,
  `sendDefaultPii`, `normalizeDepth`, `maxValueLength`, `attachStacktrace` and
  `sendClientReports`; `@probara/node` also takes `allowUrls` and `denyUrls`. The release defaults
  to the one the bundler plugins inject (`globalThis.PROBARA_RELEASE`), after `PROBARA_RELEASE` in
  Node. New functions: `lastEventId`, `setExtras`, `setLevel`, `setFingerprint`,
  `getCurrentScope` and `getIsolationScope`.

  Envelopes that fail to send for a network error or a 5xx are retried with exponential backoff and
  jitter (kept in IndexedDB in the browser and sent when it is back online or on the next `init`,
  in memory in Node); `X-Probara-Rate-Limits` stops the categories it names; the counts of dropped
  events are sent as `client_report` items. In the browser, errors thrown in `setTimeout`,
  `setInterval`, `requestAnimationFrame` and event listener callbacks are captured with
  `mechanism: instrument`, and `captureConsole` and `reportingObserver` send console calls and
  browser reports as messages. Node events carry the app's `modules`, and Angular router
  navigations are breadcrumbs with their route paths.

### Patch Changes

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`ef198d3`](https://github.com/cynch-me/probara-sdk/commit/ef198d3fe253a464a17b74e9a361316425c9a7b0) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Events report the SDK `probara.javascript.angular` with the version of `@probara/angular`
  (exported as `VERSION` and `SDK_NAME`), listing `@probara/angular` and `@probara/browser` in
  `sdk.packages`.

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`4e2d374`](https://github.com/cynch-me/probara-sdk/commit/4e2d37445e5a795a003165a1c549f25f5785435e) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Events list the debug IDs of the files their frames are in (`debug_meta.images`), from the files `probara sourcemaps inject` prepared, so Probara symbolicates them with the uploaded source maps.
- Updated dependencies [[`4500a1d`](https://github.com/cynch-me/probara-sdk/commit/4500a1d8a118b3d25fac94a01fba8b7869a66109), [`f9e6934`](https://github.com/cynch-me/probara-sdk/commit/f9e6934c90c90d5cba489321b13e6f566962840a), [`ef198d3`](https://github.com/cynch-me/probara-sdk/commit/ef198d3fe253a464a17b74e9a361316425c9a7b0), [`4e2d374`](https://github.com/cynch-me/probara-sdk/commit/4e2d37445e5a795a003165a1c549f25f5785435e), [`8a61a6c`](https://github.com/cynch-me/probara-sdk/commit/8a61a6ca6208cddb064819a8df88340a43642bd1)]:
  - @probara/browser@0.1.0
