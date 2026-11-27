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

## Script tag

Without a bundler, load `dist/probara.browser.min.js`, which sets the global `Probara` with the same
API. The loader below starts loading it without blocking the page: until it arrives, `Probara`
queues your calls and the page's uncaught errors and unhandled rejections, and the script sends
them once it loads. Put it first in `<head>`, with your DSN:

<!-- loader -->

```html
<script>
  (function (w, d, src) {
    if (w.Probara) return;
    var q = [];
    var p = { _q: q };
    'init captureException captureMessage captureEvent addBreadcrumb setUser setTag setTags setContext setExtra'
      .split(' ')
      .forEach(function (m) {
        p[m] = function () {
          q.push([m, [].slice.call(arguments)]);
        };
      });
    w.addEventListener('error', function (e) {
      if (w.Probara === p) q.push(['error', [e.error || e.message]]);
    });
    w.addEventListener('unhandledrejection', function (e) {
      if (w.Probara === p) q.push(['unhandledrejection', [e.reason]]);
    });
    w.Probara = p;
    var s = d.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    d.head.appendChild(s);
  })(
    window,
    document,
    'https://cdn.jsdelivr.net/npm/@probara/browser@0/dist/probara.browser.min.js',
  );
  Probara.init({ dsn: 'https://<public key>@<probara api host>/' });
</script>
```

Pin the version you tested in the URL. With `replay: { enabled: true }`, the script-tag build loads
the replay recorder, from `https://cdn.jsdelivr.net`, only once the replay is on: allow it in your
Content Security Policy's `script-src`.

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

| Option              | What it does                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `dsn`               | `https://<key>@<host>/`: where events go. Required.                                                                       |
| `release`           | The release of your app, matched with uploaded source maps. The one the bundler plugins inject unless given.              |
| `dist`              | The build of the release, such as `web`.                                                                                  |
| `enabled`           | `false` leaves the SDK off.                                                                                               |
| `debug`             | Logs what the SDK does with events to the console, prefixed `[probara]`.                                                  |
| `tunnel`            | A URL of your app that forwards envelopes to Probara; the envelope header carries the DSN.                                |
| `transport`         | `({ url, headers }) => ({ send(body) })`: sends envelopes your way. Retries and limits still apply.                       |
| `sendDefaultPii`    | Sends the `email` and `ip_address` given to `setUser`. Off unless true.                                                   |
| `normalizeDepth`    | How deep extra, contexts, user and breadcrumb data are kept. 3 unless given.                                              |
| `maxValueLength`    | Truncates messages, exception values, breadcrumb messages and request URLs to this length.                                |
| `attachStacktrace`  | Adds the stack of the call to messages and to captured values that are not errors.                                        |
| `sendClientReports` | Sends the counts of the events the SDK dropped, and why. On unless false.                                                 |
| `browserApiErrors`  | Captures errors thrown in timer, animation frame and event listener callbacks (`mechanism: instrument`). On unless false. |
| `captureConsole`    | `{ levels }`: sends console calls of these levels (all unless given) as message events. Off unless given.                 |
| `reportingObserver` | `{ types }`: sends the browser's `crash`, `deprecation` and `intervention` reports as messages. Off unless given.         |
| `environment`       | `production`, `staging`…                                                                                                  |
| `sampleRate`        | The share of error events sent, from 0 to 1. All of them unless given.                                                    |
| `ignoreErrors`      | Messages never sent (strings match anywhere, or regular expressions), on top of the defaults.                             |
| `allowUrls`         | Only errors thrown from these files are sent.                                                                             |
| `denyUrls`          | Errors thrown from these files are never sent, on top of browser extensions.                                              |
| `beforeSend`        | Changes an event before it is sent, or drops it by returning `null`.                                                      |
| `beforeBreadcrumb`  | Changes a breadcrumb before it is kept, or drops it by returning `null`.                                                  |
| `maxBreadcrumbs`    | Breadcrumbs per event. 100 unless given.                                                                                  |
| `initialScope`      | The user, tags, contexts and extra every event starts with.                                                               |
| `replay`            | `{ enabled: true }` records a rolling replay of the page and uploads its last minute when asked.                          |
| `httpErrors`        | `{ targets, statuses }`: failed requests sent as events.                                                                  |

By default, `ResizeObserver loop`, `AbortError` and `Script error.` are ignored, and so are errors
thrown from browser extensions. An event identical to the one before it is dropped, and at most 10
events a minute are sent. When Probara answers `429`, the SDK waits as long as `Retry-After` says,
silently, and it stops sending the categories (`error`, `replay`, `client_report`) an
`X-Probara-Rate-Limits` header names for as long as it says.

An envelope that fails to send for a network error or a 5xx is kept in IndexedDB (at most 30
envelopes and 5 MiB) and retried with exponential backoff and jitter, at most 5 times; it is sent
as soon as the browser is back online, or on the next `init`. A 4xx is never retried. The counts
of dropped events (by reason and category) are sent as a client report when the page is hidden and
on `close()`.

`setExtras`, `setLevel` and `setFingerprint` set the scope of the next events, `lastEventId()`
returns the id of the last event captured, and `getCurrentScope()` and `getIsolationScope()` hand
out the scope `withScope` runs with and the scope of the whole page.

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

On its own, the SDK keeps only what an event needs: the replay of the last minute plus the
snapshot it starts from, the last 100 console lines and requests, and no request or response
bodies. When Probara Vis starts on the page later, the capture grows to what Vis keeps (five
minutes, with bodies), keeping what it already held.

## Privacy

- Secrets in the page URL, request URLs, messages and breadcrumbs (tokens, passwords, API keys) are
  redacted before anything leaves the page, with the redaction of `@probara/vis-capture`.
- No IP address or email is collected.
- Events are sent with `fetch` (`keepalive`, a `text/plain` body, no cookies), and with
  `sendBeacon` once the page is being hidden.

## License

Apache-2.0
