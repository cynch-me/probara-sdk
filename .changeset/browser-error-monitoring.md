---
'@probara/browser': minor
---

New package: `@probara/browser`, error monitoring for the browser. `init({ dsn })` sends the
window's uncaught errors and unhandled rejections, and `captureException` and `captureMessage`
send your own, with parsed stack traces (Chrome, Firefox and Safari), breadcrumbs (console, fetch
and XHR, clicks, navigations), browser, OS, device and session context, and an opaque user only.
`ignoreErrors`, `allowUrls`, `denyUrls`, `sampleRate`, `beforeSend`, `beforeBreadcrumb`,
deduplication and a limit of 10 events a minute keep noise out; HTTP 5xx are breadcrumbs unless
their URL is in `httpErrors.targets`, `captureHttpError` sends the failures a framework's HTTP client
reports, and 400, 401 and 404 are never events. With
`replay: { enabled: true }`, the last minute of the page is uploaded when Probara asks for it, once
per tab session, from the capture Probara Vis shares when it runs on the same page.
