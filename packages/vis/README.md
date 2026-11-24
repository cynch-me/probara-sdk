<p align="center">
  <a href="https://probara.net"><img src="https://raw.githubusercontent.com/cynch-me/probara-sdk/main/.github/assets/probara-mark.png" alt="Probara" width="120"></a>
</p>

<h1 align="center">@probara/vis</h1>

<p align="center">Report a bug from your own app, or record one through a Probara recording link.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@probara/vis"><img src="https://img.shields.io/npm/v/@probara/vis?style=flat-square&color=5b3fd6&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@probara/vis"><img src="https://img.shields.io/npm/dm/@probara/vis?style=flat-square&color=5b3fd6" alt="npm downloads"></a>
  <a href="https://github.com/cynch-me/probara-sdk/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/cynch-me/probara-sdk/release.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/cynch-me/probara-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b3fd6?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/runtime-browser-5b3fd6?style=flat-square" alt="Runs in the browser">
</p>

<p align="center">
  <a href="#connect-your-site"><b>Connect your site</b></a>
  ·
  <a href="#install"><b>Install</b></a>
  ·
  <a href="#in-app-reporting"><b>In-app reporting</b></a>
  ·
  <a href="#api"><b>API</b></a>
  ·
  <a href="https://probara.net"><b>Probara</b></a>
  ·
  <a href="https://github.com/cynch-me/probara-sdk"><b>Probara SDK</b></a>
</p>

The browser SDK of [Probara Vis](https://probara.net) for your own site. Installed once in your
app with a **widget key**, it lets your users report a bug from whatever page they are on: they
send **what just happened** (an instant replay of the last minutes) or **record from the start**
([In-app reporting](#in-app-reporting)). It also opens an in-page recorder when a visitor arrives
through a Probara **recording link**, so they can record the tab they are on and send it as a Vis
with its console, network, user events and environment. It also
gives your site a **custom metadata** API, read by the recorder and by the Probara Vis browser
extension, and blurs private content automatically. It runs on the capture engine
[`@probara/vis-capture`](https://github.com/cynch-me/probara-sdk/blob/main/packages/vis-capture/README.md),
its only dependency.

## Connect your site

The recorder sends the recording to Probara's API, `https://app.probara.net`, which accepts it only
from pages on the recording domains of the link's organization, and only when the page names that
organization:

1. In Probara, open **Vis → Settings → Recording domains** and add your domain. It is in effect at
   once; no DNS record is needed. A page on that domain or any of its subdomains can record, over
   https on the default port. Pages on `localhost`, `127.0.0.1` and `[::1]` are always accepted,
   for development.
2. Copy the **organization ID** shown in the same settings, next to the recording domains, and
   pass it in the `organizations` option (or the `data-organizations` attribute of the script
   tag). It is required: a page that serves several organizations lists each one, up to 20. The
   intake refuses a link of an organization the page does not name, so another organization
   cannot record your visitors through your page.
3. Optionally, set the **recording page URL** in the same settings: recording links then open
   that page on your site with `?probara-recording=<token>`.
4. Load this package on that page (below). With a Content Security Policy, allow the API origin
   in `connect-src` ([Content Security Policy](#content-security-policy)).

Without valid `organizations` the recorder does not start: it logs one console warning and
leaves the token in the address. A page on a domain that is not a recording domain of the link's
organization, or that does not name that organization, gets no answer from the API (the browser
blocks the response), and the panel says both: the page's domain must be a recording domain of
the organization in Probara, and the page must name the organization in the recorder's
`organizations` option.

## Install

```bash
npm install @probara/vis
```

Or load the script-tag build, which bundles the capture engine, sets the global `ProbaraVis`, and
opens the recorder by itself when the page's address carries a recording link token:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@probara/vis/dist/vis.iife.js"
  data-organizations="01JABCDEFGHJKMNPQRSTVWXYZ0"
  data-blur=".customer-email"
></script>
```

| Attribute            | Meaning                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-organizations` | Required. The organization IDs the page serves, separated by spaces or commas.                                                                     |
| `data-api-origin`    | The origin of the Probara API; `https://app.probara.net` unless given.                                                                             |
| `data-blur`          | A CSS selector list blurred while recording.                                                                                                       |
| `data-locale`        | `en` or `es`; the browser's language unless given.                                                                                                 |
| `data-manual`        | Open no recorder by itself: the page calls `ProbaraVis.startRecorderFromUrl({ organizations })`. The reporter still starts with `data-widget-key`. |
| `data-widget-key`    | Starts in-app reporting with this widget key ([In-app reporting](#in-app-reporting)).                                                              |
| `data-launcher`      | With `data-widget-key`: the floating launcher (`true`, `bottom-right` or `bottom-left`).                                                           |

Pin a version in the CDN URL in production. The package ships `dist/index.js` (an ES module, with
its types in `dist/index.d.ts`, which imports `@probara/vis-capture`), `dist/vis.iife.js` (one
self-contained minified file, also exported as `@probara/vis/iife`) and `dist/reporter-token.js`
(the reporter token helper for your backend, `@probara/vis/reporter-token`).

## Record through a recording link

A recording link sends the visitor to your page with `?probara-recording=<token>`. Call
`startRecorderFromUrl()` once when your app starts:

```ts
import { startRecorderFromUrl } from '@probara/vis';

startRecorderFromUrl({
  organizations: ['01JABCDEFGHJKMNPQRSTVWXYZ0'],
  blur: ['.customer-email', '#card-number'],
  requestSanitizer: (request) => (request.url.includes('/internal/') ? null : request),
});
```

It takes the token out of the address bar at once, then shows a small card in a corner of the
page: **Ready to record?**, with a **Microphone** switch and **Start recording**. The Vis
takes the link's title, or the `title` option; the visitor never edits it. **Start recording**
opens the browser's share picker on this tab; the panel then shows whether it is recording or
paused and the time against the limit, with **Stop**, **Pause** or **Resume**, and **Discard**.
After **Stop**, the visitor watches the recording in the browser's own player and chooses
**Send**, **Record again** or **Discard**; the last two ask first, and throw the recording away. Nothing is final until **Send**: then the rest of the video,
the console, network and user events are uploaded and the Vis is finalized.
`startRecorder(token, options)` does the same for a token your code already holds.

- The video is uploaded in 8 MiB parts while it records. It stops by itself at the plan's time
  limit, and the length it reports never exceeds the limit. It also stops by itself one part
  before the largest upload the intake allows, so a very detailed recording is kept rather than
  lost. The panel tells the visitor which limit stopped it.
- Discarding (while recording or while watching), recording again, a failed upload, a refusal of
  the intake and leaving the page all abort the submission, so nothing half-sent is kept and a
  one-time link is released.
- Every request to the intake has a time limit (2 minutes for an upload, 30 seconds for the
  others, plus one second for every 8 MiB of video for the finalize, which makes a WebM seekable). A part that gets no answer is retried; a request that still gets none aborts the
  submission and the panel shows an error with **Close**.
- Where the browser cannot record (no screen sharing, as on mobile browsers, no `MediaRecorder`
  with MP4 or WebM, or no `CompressionStream`), the panel says so and offers **Close**; nothing is
  sent to the intake. `isRecordingSupported()` tells beforehand.

The panel is the only thing the recorder adds to your page, in a closed shadow root, so your styles
and its styles never meet. It uses the visitor's system font and follows your page's
`color-scheme`: on a page that declares `color-scheme: dark` it is dark. It is visible in the recording, like any element of the tab. Its own
clicks and keys are never recorded as user events and never reach your page's keyboard shortcuts.

## In-app reporting

Your users report a bug from inside your app, on any of its domains, without a link and without
typing anything about the page. The panel offers two modes, and both are reviewed before anything
is sent:

- **Send what just happened**: the instant replay. A rolling DOM replay of the page (about the
  last five minutes, within 16 MiB) and the console, network and user events it covers, held in
  memory. The review shows the time it covers, the page and a **What happened?** field (up to 2,000
  characters); then **Send** or **Discard**. Closing the review loses nothing: the instant replay
  keeps buffering, and the next time the panel opens it shows what happened up to then.
- **Record from the start**: a screen recording with its diagnostics, exactly as through a
  recording link, for a bug the user can reproduce on purpose.

### Install it once

1. In Probara, open **Vis → Settings → In-app reporting** and create a widget key. It is public
   and send-only: it can start reports into your organization and read nothing. Copy the key and
   the organization ID shown there.
2. Start the reporter when your app starts:

```ts
import { createReporter } from '@probara/vis';

const reporter = createReporter({
  widgetKey: 'pvk_...',
  organizations: ['01JABCDEFGHJKMNPQRSTVWXYZ0'],
});
```

Or with the script tag:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@probara/vis/dist/vis.iife.js"
  data-widget-key="pvk_..."
  data-organizations="01JABCDEFGHJKMNPQRSTVWXYZ0"
  data-launcher="bottom-right"
></script>
```

A page has one reporter: `createReporter` returns the same one until it is destroyed (so the
script-tag page can call `ProbaraVis.createReporter(...)` to get it). Invalid options return
`null` with one console warning; nothing throws into your page.

Unless the widget requires a verified reporter and accepts any origin, the page must be on one of
your organization's recording domains, as for recording links ([Connect your site](#connect-your-site)).

### Your own button, or the launcher

Open the panel from your own "Report a problem" button:

```ts
reportButton.addEventListener('click', () => reporter?.open());
// Or straight to one mode: reporter?.open('instant-replay'), reporter?.open('record')
```

Or let the reporter show a floating launcher with `launcher: true` (or
`{ position: 'bottom-left', label: 'Help' }`). It is a real button with a visible focus ring,
hidden while the panel is open and on a browser that can neither record nor keep an instant
replay. Its colours follow your page, so each store keeps its own; set both together, since
with only the background the text keeps the panel's colour:

```css
:root {
  --probara-vis-accent: #0b5cff; /* background; the panel's card colour unless set */
  --probara-vis-accent-contrast: #ffffff; /* text and mark; the panel's text colour unless set */
}
```

### Your own form

When your app collects the report in its own form, send the instant replay when the form is
submitted, in the background, with no panel: what happened up to that moment, with the form's
text as its **What happened?**. A screen recording stays available with `reporter.open('record')`;
after one, the call also sends what happened before the recording.

```ts
const pending = new Set<Promise<unknown>>();
window.addEventListener('beforeunload', (event) => {
  if (pending.size > 0) event.preventDefault();
});

form.addEventListener('submit', () => {
  const sent = reporter?.sendInstantReplay({ description: note.value });
  if (sent === undefined) return;
  pending.add(sent);
  void sent.then((result) => {
    pending.delete(sent);
    if (result.status === 'sent') linkToNote(result.url);
  });
  closeDialog();
});
```

The promise never rejects: it resolves `sent` (with `visUlid` and `url`), `no-replay`,
`busy`, `unavailable`, `failed` or `cancelled` ([API reference](docs/api.md#sendinstantreplayrequest)).
`onReport` is called for every report Probara receives, the recordings sent from the panel
included.

`reporter.close()` closes the panel (a report in progress is discarded); `reporter.destroy()`
stops every capture, puts back the page's `fetch`, `XMLHttpRequest`, console and `WebSocket`,
and removes the launcher.

### Verified reporters

When the user is signed in, your backend can sign a short-lived token that says who reports, with
the widget's **signing secret** (shown with the key in Probara; keep it on the server). The token
travels with the start of each report; a report without one still works, unless the widget has
**Require verified reporter** on.

```ts
// server.ts (Node 20+, Deno, Bun or Workers: Web Crypto only)
import express from 'express';
import { signReporterToken } from '@probara/vis/reporter-token';

const app = express();
app.get('/probara/reporter-token', async (req, res) => {
  const token = await signReporterToken(process.env.PROBARA_VIS_SIGNING_SECRET!, {
    sub: req.user.id, // optional: works before login too
    name: req.user.name,
    email: req.user.email,
    attributes: { tenant: req.tenant.slug, store: req.store.id, role: req.user.role },
    expiresInSeconds: 600, // 1 to 3,600; one hour unless given
  });
  res.json({ token });
});
```

```ts
// app.ts
const reporter = createReporter({
  widgetKey: 'pvk_...',
  organizations: ['01JABCDEFGHJKMNPQRSTVWXYZ0'],
  reporterToken: async () => {
    const answer = await fetch('/probara/reporter-token');
    return answer.ok ? ((await answer.json()) as { token: string }).token : null;
  },
});
```

`reporterToken` is called once per report. A throw, a rejection, `null` or no answer within 30
seconds sends the report without a token. When the widget refuses it, the panel says so: "Sign in
to report a problem." without a token where one is required, "Your session could not be verified."
for an expired or invalid one.

### Performance

The instant replay costs the page as little as it can:

- The replay recorder (rrweb, about 23 kB gzip) loads lazily, after the page is idle, and only
  when the widget keeps an instant replay. Turn it off for a widget in Probara, without a release:
  the page then never loads it.
- It stops itself on a page that changes too much: past 10,000 DOM mutations within one two-minute
  segment, the replay stops and records why; the diagnostics go on.
- Blurred elements are blocked from the replay, so a heavy zone marked to blur
  (`data-probara-blur`, `<meta name="probara:blur">`, the `blur` option) costs nothing to record.
- Memory is bounded by time and size: five minutes, and at most 1,000 console entries (1 MiB),
  1,000 requests (8 MiB) and 2,000 user events (1 MiB).
- Nothing is uploaded until the user sends a report.

A performance test holds this to a budget: on a heavy page (a 6,000-cell table updated on a timer
and re-rendered whole, typing, clicks and requests), the same 15-second scripted session runs with
and without a reporter keeping an instant replay, and the total blocking time it adds (the time long
tasks spend past 50 ms; the quietest session with it minus the quietest without it, as a busy
machine only adds to both) must stay under 100 ms. On an Apple Silicon laptop it adds under 10 ms; a
replay that went on recording past its mutation limit adds 290-750 ms. Run it with
`pnpm --filter @probara/vis test:perf`, on a quiet machine. CI does not run it: the tests of the
replay (`replay.browser.test.ts` of the capture engine, `buffers.browser.test.ts` here) already
hold that it stops at its mutation limit.

Blur and your sanitizers apply to everything buffered, as to a recording; buffering blurs nothing
on screen.

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
a JSON object (a Promise included), or would take the whole over 10 KiB once serialized or deeper
than 32 levels (an object of scalar values is 1 level, each object or array inside another adds
one) is skipped.
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
- A widget key is public and send-only. The signing secret is not: sign reporter tokens on your
  server only. The instant replay stays in the page's memory until the user sends it.
- Every request to the intake is sent without credentials (no cookie, no `Authorization`),
  without a referrer and without caching. It carries the `organizations` in the
  `probara-organizations` header, and the intake serves it only for a link of one of them. The intake's own requests are left out of the network
  capture.
- Importing the package does nothing by itself: no listener, no global, no request. No function
  throws into your page.

## Content Security Policy

With a Content Security Policy, allow:

| Directive     | Value                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| `connect-src` | The API origin (`https://app.probara.net`, or `apiOrigin`), for the intake.         |
| `media-src`   | `blob:`, so the visitor can watch the recording before sending it.                  |
| `script-src`  | Where the script-tag build is served from, when you load it by a `<script>` tag.    |
| `script-src`  | `https://cdn.jsdelivr.net`, for the instant replay of the script-tag build (below). |

The script-tag build cannot split its code, so for the instant replay it loads the replay script of
the capture engine it bundles, from
`https://cdn.jsdelivr.net/npm/@probara/vis-capture@<version>/dist/vis-capture-replay.iife.js`.
When your policy refuses it, the reporter offers recording only. The npm build has no such need:
your bundler splits the replay into a chunk of your own app.

Nothing else is needed: the panel is built with DOM calls (no `innerHTML`, so Trusted Types pass)
and styled with a constructed stylesheet (no `'unsafe-inline'`), the blur goes through the CSSOM,
and the recorder starts no worker. A `Permissions-Policy` that denies `display-capture` (or
`microphone`) stops screen sharing (or the microphone) on the page.

## Size

| File                     | Minified  | gzip    |
| ------------------------ | --------- | ------- |
| `dist/vis.iife.js`       | 92.5 kB   | 31.8 kB |
| `dist/index.js`          | 95.1 kB\* | 27.5 kB |
| `dist/reporter-token.js` | 5.6 kB\*  | 2.2 kB  |

\* Not minified, and without `@probara/vis-capture`, which your bundler adds. The build test keeps
the script-tag file under 33 KiB gzip-compressed. The replay recorder is not in either: it loads
apart, only for an instant replay.

## API

[docs/api.md](docs/api.md) lists every export, option and state.

## License

Apache-2.0
