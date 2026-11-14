# @probara/vis

The browser SDK of [Probara Vis](https://probara.net) for your own site. It opens an in-page
recorder when a visitor arrives through a Probara **recording link**, so they can record the tab
they are on and send it as a Vis with its console, network, user events and environment. It also
gives your site a **custom metadata** API, read by the recorder and by the Probara Vis browser
extension, and blurs private content automatically. It runs on the capture engine
[`@probara/vis-capture`](https://github.com/cynch-me/probara-sdk/blob/main/packages/vis-capture/README.md),
its only dependency.

> **Same origin only, for now.** The recording intake accepts requests from Probara's own origin
> only. Until Probara accepts the origins of your verified domains, a recorder on another origin is
> refused by the browser (CORS): build and test with the page and `apiOrigin` on the same origin.

## Install

```bash
npm install @probara/vis
```

Or load the script-tag build, which bundles the capture engine, sets the global `ProbaraVis`, and
opens the recorder by itself when the page's address carries a recording link token:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@probara/vis/dist/vis.iife.js"
  data-blur=".customer-email"
></script>
```

| Attribute         | Meaning                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `data-api-origin` | The origin of the Probara API; the page's own origin unless given.          |
| `data-blur`       | A CSS selector list blurred while recording.                                |
| `data-locale`     | `en` or `es`; the browser's language unless given.                          |
| `data-manual`     | Open nothing by itself: the page calls `ProbaraVis.startRecorderFromUrl()`. |

Pin a version in the CDN URL in production. The package ships `dist/index.js` (an ES module, with
its types in `dist/index.d.ts`, which imports `@probara/vis-capture`) and `dist/vis.iife.js` (one
self-contained minified file, also exported as `@probara/vis/iife`).

## Record through a recording link

A recording link sends the visitor to your page with `?probara-recording=<token>`. Call
`startRecorderFromUrl()` once when your app starts:

```ts
import { startRecorderFromUrl } from '@probara/vis';

startRecorderFromUrl({
  blur: ['.customer-email', '#card-number'],
  requestSanitizer: (request) => (request.url.includes('/internal/') ? null : request),
});
```

It takes the token out of the address bar at once, then shows a small panel in a corner of the
page: the organization, the title (the visitor may change it), the microphone and the longest
recording the plan allows. **Start recording** opens the browser's share picker on this tab; the
panel then shows the time against the limit, with **Pause**, **Resume**, **Stop and send** and
**Discard**. When the recording ends, the rest of the video, the console, network and user events
are uploaded and the Vis is finalized. `startRecorder(token, options)` does the same for a token
your code already holds.

- The video is uploaded in 8 MiB parts while it records. It stops by itself at the plan's time
  limit, and the length it reports never exceeds the limit. It also stops by itself one part
  before the largest upload the intake allows, so a very detailed recording is sent rather than
  lost. The panel tells the visitor which limit stopped it.
- Discarding, a failed upload, a refusal of the intake and leaving the page all abort the
  submission, so nothing half-sent is kept and a one-time link is released.
- Every request to the intake has a time limit (2 minutes for an upload, 30 seconds for the
  others). A part that gets no answer is retried; a request that still gets none aborts the
  submission and the panel shows an error with **Close**.
- Where the browser cannot record (no screen sharing, as on mobile browsers, no `MediaRecorder`
  with MP4 or WebM, or no `CompressionStream`), the panel says so and offers **Close**; nothing is
  sent to the intake. `isRecordingSupported()` tells beforehand.

The panel is the only thing the recorder adds to your page, in a closed shadow root, so your styles
and its styles never meet. It is visible in the recording, like any element of the tab. Its own
clicks and keys are never recorded as user events and never reach your page's keyboard shortcuts.

## Custom metadata

```ts
import { metadata } from '@probara/vis';

const unregister = metadata(() => ({
  userId: session.user.id,
  plan: session.organization.plan,
}));
```

Each provider is called when a Vis is captured on the page, by this recorder (when the recording
starts) or by the Probara Vis extension, and returns a JSON object. Several providers merge in the
order they were registered, a later one winning a key. A provider that throws, returns anything but
a JSON object (a Promise included), or would take the whole over 10 KiB once serialized is skipped.
Registering touches nothing on the page until the first provider; the extension reads it over the
[handshake of the capture engine](https://github.com/cynch-me/probara-sdk/blob/main/packages/vis-capture/README.md#custom-metadata).

## Blur

While recording, these render blurred on the page, so the video shows them blurred, and user events
never take their text:

1. elements with the `data-probara-blur` attribute;
2. the privacy markers of other session replay tools, so a site already marked for them needs
   nothing more: rrweb (`.rr-block`, `.rr-mask`), Sentry (`.sentry-block`, `.sentry-mask`,
   `[data-sentry-block]`, `[data-sentry-mask]`), FullStory (`.fs-exclude`, `.fs-mask`), Hotjar
   (`[data-hj-suppress]`), LogRocket (`[data-private]`), OpenReplay
   (`[data-openreplay-obscured]`, `[data-openreplay-masked]`, `[data-openreplay-hidden]`), Datadog
   (`[data-dd-privacy="mask"]`, `[data-dd-privacy="hidden"]`, `.dd-privacy-mask`,
   `.dd-privacy-hidden`), PostHog (`.ph-no-capture`) and Microsoft Clarity
   (`[data-clarity-mask="true"]`); the list is `PRIVACY_SELECTORS`;
3. the selector list of every `<meta name="probara:blur" content="...">` tag;
4. the selectors of the `blur` option (or `data-blur`).

Every selector also covers elements added later. A selector that is not valid CSS is skipped. The
blur is applied through the CSSOM, which a Content Security Policy does not block, and removed when
the recording ends.

## Sanitizers

The recorder passes `logSanitizer`, `requestSanitizer`, `responseSanitizer` and
`webSocketSanitizer` to the capture engine. They are synchronous: return the (possibly changed)
value to keep it, or `null` to drop it. They fail closed: a sanitizer that throws or returns
anything else gets the content it guarded replaced with `PROBARA_SANITIZER_REDACTED`. The engine's
built-in redaction of tokens, cookies, credentials, card numbers and the like always runs after
them. See [Redaction and sanitizers](https://github.com/cynch-me/probara-sdk/blob/main/packages/vis-capture/README.md#redaction-and-sanitizers).

## Privacy and safety

- The link token is a secret: it is read once, removed from the address bar, never logged, and
  sent only to the intake, in the request path.
- Every request to the intake is sent without credentials (no cookie, no `Authorization`),
  without a referrer and without caching. The intake's own requests are left out of the network
  capture.
- Importing the package does nothing by itself: no listener, no global, no request. No function
  throws into your page.

## Content Security Policy

With a Content Security Policy, allow:

| Directive     | Value                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| `connect-src` | The API origin (`apiOrigin`), for the intake.                                    |
| `script-src`  | Where the script-tag build is served from, when you load it by a `<script>` tag. |

Nothing else is needed: the panel is built with DOM calls (no `innerHTML`, so Trusted Types pass)
and styled with a constructed stylesheet (no `'unsafe-inline'`), the blur goes through the CSSOM,
and the recorder starts no worker. A `Permissions-Policy` that denies `display-capture` (or
`microphone`) stops screen sharing (or the microphone) on the page.

## Size

| File               | Minified  | gzip    |
| ------------------ | --------- | ------- |
| `dist/vis.iife.js` | 64.7 kB   | 23.0 kB |
| `dist/index.js`    | 43.8 kB\* | 13.7 kB |

\* Not minified, and without `@probara/vis-capture`, which your bundler adds. The build test keeps
the script-tag file under 28 KiB gzip-compressed.

## API

[docs/api.md](docs/api.md) lists every export, option and state.

## License

Apache-2.0
