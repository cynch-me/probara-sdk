# @probara/browser

Error monitoring for the browser with [Probara](https://probara.net): uncaught errors, unhandled
promise rejections and the errors your app captures are sent with their stack trace, the
breadcrumbs of what led to them, the browser and page they happened on and, when enabled, a replay
of the last minute. On a page that also runs [Probara Vis](../vis/README.md), both share one
capture engine (`@probara/vis-capture`): the console, the network and the DOM are recorded once.

## Install

```sh
npm install @probara/browser
```

## Start

Call `init` once, as early as possible, with the DSN of your Probara project:

```ts
import * as Probara from '@probara/browser';

Probara.init({
  dsn: 'https://<public key>@<probara api host>/',
  release: 'shop@2.4.0',
  environment: 'production',
});
```

From then on, the window's uncaught errors and unhandled rejections are sent as unhandled events.
A DSN that cannot be read leaves the SDK off; nothing it does throws into your page.

## Capture

```ts
try {
  await checkout();
} catch (error) {
  Probara.captureException(error);
}
Probara.captureMessage('Payment provider answered slowly', 'warning');
```

Add what helps you find the cause, to every event that follows:

```ts
Probara.setUser({ id: 'u_8f2a', username: 'store-42' });
Probara.setTag('tenant', 'ucsf');
Probara.setContext('cart', { items: 3 });
Probara.setExtra('attempt', 2);
Probara.addBreadcrumb({ category: 'auth', message: 'Signed in' });
Probara.withScope((scope) => {
  scope.setTag('step', 'payment');
  Probara.captureException(error);
});
```

`setUser` keeps only `id`, `username` and `segment`: an email or IP address given is dropped.

## Breadcrumbs

Each event carries the last 100 breadcrumbs (`maxBreadcrumbs`):

- **Console.** Every console call. `console.error` and `console.warn` never create events.
- **Requests.** Every `fetch` and XHR request with its method, URL and status. An HTTP 5xx is a
  breadcrumb, not an event, unless its URL is one of `httpErrors.targets`:

  ```ts
  Probara.init({ dsn, httpErrors: { targets: [/\/api\/payments\//], statuses: [[500, 599]] } });
  ```

  400, 401 and 404 are never sent as events. A framework's HTTP client can report its own
  failures with `captureHttpError({ url, method, status }, 'my-framework.http')`, under the same
  rules: the URL is redacted, and 400, 401 and 404 are never sent.

- **Clicks and navigations**, by the CSS selector of the element clicked.

## Options

| Option             | What it does                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `dsn`              | `https://<key>@<host>/`: where events go. Required.                                              |
| `release`          | The release of your app, matched with uploaded source maps.                                      |
| `environment`      | `production`, `staging`…                                                                         |
| `sampleRate`       | The share of error events sent, from 0 to 1. All of them unless given.                           |
| `ignoreErrors`     | Messages never sent (strings match anywhere, or regular expressions), on top of the defaults.    |
| `allowUrls`        | Only errors thrown from these files are sent.                                                    |
| `denyUrls`         | Errors thrown from these files are never sent, on top of browser extensions.                     |
| `beforeSend`       | Changes an event before it is sent, or drops it by returning `null`.                             |
| `beforeBreadcrumb` | Changes a breadcrumb before it is kept, or drops it by returning `null`.                         |
| `maxBreadcrumbs`   | Breadcrumbs per event. 100 unless given.                                                         |
| `initialScope`     | The user, tags, contexts and extra every event starts with.                                      |
| `replay`           | `{ enabled: true }` records a rolling replay of the page and uploads its last minute when asked. |
| `httpErrors`       | `{ targets, statuses }`: failed requests sent as events.                                         |

By default, `ResizeObserver loop`, `AbortError` and `Script error.` are ignored, and so are errors
thrown from browser extensions. An event identical to the one before it is dropped, and at most 10
events a minute are sent. When Probara answers `429`, the SDK waits as long as `Retry-After` says,
silently.

## Source maps

Run `probara sourcemaps inject` on the build output before you deploy it, and
`probara sourcemaps upload` for the `release` you pass to `init`
([source maps](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#source-maps)): the frames of your errors then show the original source. An injected
file registers its debug ID when it loads, and each event lists the debug IDs of the files its
frames are in, so no URL has to match.

## Replay

With `replay: { enabled: true }`, the SDK keeps a rolling replay of the page in memory, and uploads
the last minute or so only when Probara asks for it, for the first events of a new issue, and at
most once per tab session. Every input is masked, password fields are never recorded, and the
privacy markers of other session replay tools are blocked. On a page where Probara Vis already
records its instant replay, the SDK reads that one: nothing is recorded twice.

## Privacy

- Secrets in the page URL, request URLs, messages and breadcrumbs (tokens, passwords, API keys) are
  redacted before anything leaves the page, with the redaction of `@probara/vis-capture`.
- No IP address or email is collected.
- Events are sent with `fetch` (`keepalive`, a `text/plain` body, no cookies), and with
  `sendBeacon` once the page is being hidden.

## License

Apache-2.0
