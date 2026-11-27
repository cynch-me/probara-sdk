# @probara/node

Error monitoring for Node.js with [Probara](https://probara.net): uncaught exceptions, unhandled
promise rejections and the errors your server captures are sent with their stack trace, the source
lines around your own frames, the breadcrumbs of what led to them, and the runtime, OS and host
they happened on. Each request handled through the Express or Hono middleware keeps a scope of its
own.

Requires Node.js 20 or later. Works with `import` and `require`.

## Install

```sh
npm install @probara/node
```

## Start

Call `init` once, as early as possible, before the rest of your app is loaded:

```ts
import * as Probara from '@probara/node';

Probara.init({
  dsn: 'https://<public key>@<probara api host>/',
});
```

`release` comes from `PROBARA_RELEASE`, `environment` from `PROBARA_ENVIRONMENT` or `NODE_ENV`,
and `serverName` from the host name, unless you pass them. A DSN that cannot be read leaves the SDK
off; nothing it does throws into your app.

## Express

```ts
import express from 'express';
import * as Probara from '@probara/node';

const app = express();
app.use(Probara.probaraRequestHandler()); // first: each request gets its own scope
// …your routes…
app.use(Probara.probaraErrorHandler()); // after the routes, before your own error handlers
```

`probaraErrorHandler` sends errors without a status or with a 5xx status, then passes them on to
the next error handler. Change which errors are sent with `shouldHandleError`.

## Hono

```ts
import { Hono } from 'hono';
import * as Probara from '@probara/node';

const app = new Hono();
app.use(Probara.probaraHono());
app.onError((error, c) => c.text('Something went wrong', 500));
```

Errors your routes throw are sent, unless they ask for a status below 500 (an `HTTPException(401)`
is not); `app.onError` still answers the request.

## Capture

```ts
try {
  await chargeCard(order);
} catch (error) {
  Probara.captureException(error);
}
Probara.captureMessage('Payment provider answered slowly', 'warning');

Probara.setUser({ id: 'u_8f2a' });
Probara.setTag('tenant', 'ucsf');
Probara.setContext('order', { items: 3 });
Probara.addBreadcrumb({ category: 'queue', message: 'Job picked up' });
await Probara.withScope(async (scope) => {
  scope.setTag('job', 'invoices');
  await runInvoices();
});
```

Inside a request handled by the middleware, or a `withScope` callback, `setUser`, `setTag` and
the breadcrumbs added stay with that request, across its `await`s; concurrent requests never see
each other's. `setUser` keeps only `id`, `username` and `segment`.

## Uncaught errors

| Option                 | Values                         | What happens after the event is sent                                                                                         |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `onUncaughtException`  | `'exit'` (default)             | The error is printed and the process exits with code 1, as Node does, unless your app listens to `uncaughtException` itself. |
|                        | `'keep-alive'`                 | The error is printed and the process keeps running.                                                                          |
| `onUnhandledRejection` | `'warn'` (default), `'strict'` | `warn` prints a warning and keeps running; `strict` prints the reason and exits with code 1.                                 |

Before exiting, the SDK waits up to 2 seconds for the event to leave. Before your own shutdown,
call `await Probara.close()` (or `flush(timeoutMs)`, which resolves `false` when time ran out).

## Breadcrumbs and outgoing requests

Every outgoing `fetch` request is a breadcrumb with its method, URL (secret query parameters
redacted) and status. An HTTP 5xx is a breadcrumb, not an event, unless its URL starts with one of
`httpErrors.targets`:

```ts
Probara.init({
  dsn,
  httpErrors: { targets: ['https://payments.internal/'], statuses: [[500, 599]] },
});
```

400, 401 and 404 are never sent as events.

## Options

| Option               | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `dsn`                | `https://<key>@<host>/`: where events go. Required.                          |
| `release`            | The release of your app. `PROBARA_RELEASE` unless given.                     |
| `environment`        | `PROBARA_ENVIRONMENT`, then `NODE_ENV`, unless given.                        |
| `serverName`         | The host name unless given.                                                  |
| `appRoot`            | The folder frame modules are named from. The working directory unless given. |
| `sampleRate`         | The share of error events sent, from 0 to 1. All of them unless given.       |
| `ignoreErrors`       | Messages never sent (strings match anywhere, or regular expressions).        |
| `beforeSend`         | Changes an event before it is sent, or drops it by returning `null`.         |
| `beforeBreadcrumb`   | Changes a breadcrumb before it is kept, or drops it by returning `null`.     |
| `maxBreadcrumbs`     | Breadcrumbs per event. 100 unless given.                                     |
| `maxEventsPerMinute` | The most events sent a minute. 60 unless given.                              |
| `initialScope`       | The user, tags, contexts and extra every event starts with.                  |
| `httpErrors`         | `{ targets, statuses }`: failed outgoing requests sent as events.            |

An event identical to the one before it is dropped. When Probara answers `429`, the SDK waits as
long as `Retry-After` says, silently.

## Stack traces

Frames under `node_modules` and Node's own (`node:`) are marked as not in your app. Each frame
in a file names its `module`, which grouping reads with the function name: the path from the
package folder for a dependency (`express/lib/router/index`), or from `appRoot` for your own code
(`src/routes/orders`), without the extension and with `/` on every OS. Your own frames carry the 5 lines before and after their line, read from disk (files over 1 MB are skipped).
For bundled or compiled code, run `probara sourcemaps inject` on the build output and
`probara sourcemaps upload` for the `release` you pass to `init` ([source maps](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#source-maps)): the
frames of your errors then show the original source. An injected file registers its debug ID when
it loads, and each event lists the debug IDs of the files its frames are in.

## Privacy

- Requests carry their method, URL and headers, without `authorization`, cookies, API keys, tokens
  or the client's IP address (`x-forwarded-for` and the like); secret query parameters are
  replaced by `[Filtered]`.
- No IP address or email is collected.

## License

Apache-2.0
