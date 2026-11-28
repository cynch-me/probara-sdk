# @probara/node

## 0.1.0

### Minor Changes

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

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`0fe9124`](https://github.com/cynch-me/probara-sdk/commit/0fe91244076039ee6dbcf7a88b90bb0735fd591a) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New package: `@probara/node`, error monitoring for Node.js 20 and later. `init({ dsn })` sends
  uncaught exceptions (then exits with code 1 as Node does, unless the app listens itself or
  `onUncaughtException: 'keep-alive'`) and unhandled rejections (`onUnhandledRejection: 'warn'` keeps
  running, `'strict'` exits), and `captureException` and `captureMessage` send your own, with the
  source lines around in-app frames, runtime, OS, app and server name, and outgoing `fetch` requests
  as breadcrumbs (5xx sent as events only for `httpErrors.targets`, never 400, 401 or 404). Each
  request through `probaraRequestHandler()` and `probaraErrorHandler()` (Express) or `probaraHono()`
  (Hono) keeps its own scope, with its request scrubbed of credentials, cookies, client IP addresses
  and secret query parameters. `release` and `environment` default to `PROBARA_RELEASE` and
  `PROBARA_ENVIRONMENT` or `NODE_ENV`; `flush(timeout)` and `close(timeout)` wait for the last events.

### Patch Changes

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`4e2d374`](https://github.com/cynch-me/probara-sdk/commit/4e2d37445e5a795a003165a1c549f25f5785435e) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Events list the debug IDs of the files their frames are in (`debug_meta.images`), from the files `probara sourcemaps inject` prepared, so Probara symbolicates them with the uploaded source maps.

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`ef198d3`](https://github.com/cynch-me/probara-sdk/commit/ef198d3fe253a464a17b74e9a361316425c9a7b0) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Stack frames carry `module`: a dependency's path from its `node_modules` folder
  (`express/lib/router/index`) or your file's path from `appRoot` (`src/routes/orders`, the working
  directory unless given), without the extension and with `/` separators, so grouping can use the
  module with the function name.
