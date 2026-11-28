# @probara/browser

## 0.1.0

### Minor Changes

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`4500a1d`](https://github.com/cynch-me/probara-sdk/commit/4500a1d8a118b3d25fac94a01fba8b7869a66109) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New package: `@probara/browser`, error monitoring for the browser. `init({ dsn })` sends the
  window's uncaught errors and unhandled rejections, and `captureException` and `captureMessage`
  send your own, with parsed stack traces (Chrome, Firefox and Safari), breadcrumbs (console, fetch
  and XHR, clicks, navigations), browser, OS, device and session context, and an opaque user only.
  `ignoreErrors`, `allowUrls`, `denyUrls`, `sampleRate`, `beforeSend`, `beforeBreadcrumb`,
  deduplication and a limit of 10 events a minute keep noise out; HTTP 5xx are breadcrumbs unless
  their URL is in `httpErrors.targets`, `captureHttpError` sends the failures a framework's HTTP client
  reports, and 400, 401 and 404 are never events. With
  `replay: { enabled: true }`, the last minute of the page is uploaded when Probara asks for it, once
  per tab session, from the capture Probara Vis shares when it runs on the same page.

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`ef198d3`](https://github.com/cynch-me/probara-sdk/commit/ef198d3fe253a464a17b74e9a361316425c9a7b0) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - A script-tag build, `dist/probara.browser.min.js`, sets the global `Probara`, and the README
  documents a loader snippet that queues calls, uncaught errors and unhandled rejections until the
  script arrives. The replay loads only when it is on (from the engine's published replay script in
  the script-tag build). On a page without Probara Vis, the shared capture keeps error-sized buffers
  and no request or response bodies, and events list `npm:@probara/browser` in `sdk.packages`.

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

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`f9e6934`](https://github.com/cynch-me/probara-sdk/commit/f9e6934c90c90d5cba489321b13e6f566962840a) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - The replay uploaded with an event now carries the console, the network requests (without their
  bodies) and the user events of the same window, as custom replay events tagged `probara.console`,
  `probara.network` and `probara.events` whose payload is the entry Probara Vis uploads, so the
  error replay shows them in step with the page. Entries older than the replay are left out.

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`4e2d374`](https://github.com/cynch-me/probara-sdk/commit/4e2d37445e5a795a003165a1c549f25f5785435e) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Events list the debug IDs of the files their frames are in (`debug_meta.images`), from the files `probara sourcemaps inject` prepared, so Probara symbolicates them with the uploaded source maps.
- Updated dependencies [[`740baeb`](https://github.com/cynch-me/probara-sdk/commit/740baeb7d1a466650ba4ad837048467cf6a3f791), [`2acc72a`](https://github.com/cynch-me/probara-sdk/commit/2acc72aa1d1cfe6e23b4bc474171b7c8772138e3), [`8d12fbf`](https://github.com/cynch-me/probara-sdk/commit/8d12fbfd80fa7877cb8146ddebbfa52bcef0c842)]:
  - @probara/vis-capture@0.5.0
