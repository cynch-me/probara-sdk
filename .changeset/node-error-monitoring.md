---
'@probara/node': minor
---

New package: `@probara/node`, error monitoring for Node.js 20 and later. `init({ dsn })` sends
uncaught exceptions (then exits with code 1 as Node does, unless the app listens itself or
`onUncaughtException: 'keep-alive'`) and unhandled rejections (`onUnhandledRejection: 'warn'` keeps
running, `'strict'` exits), and `captureException` and `captureMessage` send your own, with the
source lines around in-app frames, runtime, OS, app and server name, and outgoing `fetch` requests
as breadcrumbs (5xx sent as events only for `httpErrors.targets`, never 400, 401 or 404). Each
request through `probaraRequestHandler()` and `probaraErrorHandler()` (Express) or `probaraHono()`
(Hono) keeps its own scope, with its request scrubbed of credentials, cookies, client IP addresses
and secret query parameters. `release` and `environment` default to `PROBARA_RELEASE` and
`PROBARA_ENVIRONMENT` or `NODE_ENV`; `flush(timeout)` and `close(timeout)` wait for the last events.
