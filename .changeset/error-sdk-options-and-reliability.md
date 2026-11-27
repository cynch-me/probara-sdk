---
'@probara/browser': minor
'@probara/node': minor
'@probara/angular': minor
---

New options, as in Sentry's SDKs: `enabled`, `debug`, `dist`, `tunnel`, a custom `transport`,
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
