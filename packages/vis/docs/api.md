# API reference

Everything `@probara/vis` exports, from `import { ... } from '@probara/vis'` or the
`ProbaraVis` global of the script-tag build. See the [README](../README.md) for the guide.

## `startRecorderFromUrl(options)`

Reads a recording link token from the page's address (`?probara-recording=<token>`), removes the
parameter from the address bar with `history.replaceState` (the rest of the address and the
history state are kept), and opens the recorder for it. Returns the `Recorder`, or `null` when
`organizations` is not valid, the address carries no valid token or `apiOrigin` is not an
http(s) URL. Where the browser cannot record, the recorder opens in the `unsupported` state and
sends nothing. Without valid `organizations` (missing, empty, more than 20, or a value that is
not an organization ID), it logs one console warning and leaves the parameter in the address;
otherwise the parameter is removed even when the token is refused. Never throws.

## `startRecorder(token, options)`

Opens the recorder for a token your code already holds. Returns the `Recorder`, or `null` as
above (an invalid `organizations` also logs one console warning). While a recorder is open, both functions return that one: a page has one recorder at a time.

### `RecorderOptions`

| Option               | Type                    | Default                   | Meaning                                                                         |
| -------------------- | ----------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `organizations`      | `readonly string[]`     | required                  | The IDs (ULIDs) of the Probara organizations the page serves, 1 to 20.          |
| `apiOrigin`          | `string`                | `https://app.probara.net` | The origin of the Probara API; anything after the origin is ignored.            |
| `title`              | `string`                | the link's title          | The title of this recording; the visitor never edits it.                        |
| `reference`          | `string`                | the link's reference      | Free text kept on the Vis, up to 200 characters.                                |
| `folder`             | `string`                | the link's folder         | The ULID of a folder that is not private.                                       |
| `microphone`         | `boolean`               | the link's default        | Whether the microphone starts on.                                               |
| `blur`               | `readonly string[]`     | none                      | CSS selectors blurred while recording, on top of the automatic ones.            |
| `ignoreUrls`         | `readonly UrlPattern[]` | none                      | Requests left out of the network capture (a string prefix or a RegExp).         |
| `logSanitizer`       | `LogSanitizer`          | none                      | Gets each console entry; returns it (changed or not) or `null` to drop it.      |
| `requestSanitizer`   | `RequestSanitizer`      | none                      | Gets `{ url, method, headers, body }`; `null` drops the whole request.          |
| `responseSanitizer`  | `ResponseSanitizer`     | none                      | Gets `{ url, status, headers, body }`; `null` drops the whole request.          |
| `webSocketSanitizer` | `WebSocketSanitizer`    | none                      | Gets `{ socketId, direction, data }`; `null` drops the message.                 |
| `locale`             | `'en' \| 'es'`          | the browser's language    | The language of the panel: Spanish for `es` and its regions, English otherwise. |
| `onStateChange`      | `(state) => void`       | none                      | Called on each change of state.                                                 |

`title`, `reference`, `folder` and `microphone` override the link's own values exactly as the
recording link URL's parameters do: the intake validates them, and one it refuses (a private or
unknown folder, a reference over 200 characters) puts the recorder in the `unavailable` state.

### `Recorder`

| Member    | Meaning                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `state`   | The current `RecorderState`.                                                       |
| `close()` | Closes the panel. A recording in progress is discarded and its submission aborted. |

### `RecorderState`

| State         | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `loading`     | Reading the link.                                                                                       |
| `unavailable` | The link is unknown, revoked, expired or used, an override is refused, or the plan allows no recording. |
| `busy`        | Too many recordings through the link at once, or too many requests: try again later.                    |
| `ready`       | Ready to record.                                                                                        |
| `starting`    | The visitor is choosing what to share; the submission is being started.                                 |
| `recording`   | Recording.                                                                                              |
| `paused`      | Paused; paused time does not count towards the limit nor the video's length.                            |
| `review`      | The recording ended and is watched in the panel; its parts go on uploading, nothing is final yet.       |
| `sending`     | The visitor sent the recording; the rest is being uploaded and the Vis finalized.                       |
| `done`        | The Vis was finalized.                                                                                  |
| `failed`      | The link could not be read, or the recording could not be sent; its submission was aborted.             |
| `closed`      | The recorder was closed, or the page went away (its submission, if any, was aborted).                   |
| `unsupported` | The browser cannot record the screen (see `isRecordingSupported()`); nothing was sent.                  |

A visitor who cancels the share picker goes back to `ready`; so does a discard, while recording
(at once) or in `review` (once confirmed). In `review` the panel offers **Send**, **Record again**
(confirmed: the recording is thrown away and a new one starts at once) and **Discard**; a discard
or a new recording aborts the submission. When the panel's player cannot play the recording (the
video element reports an error, such as a decode failure), the panel says the recording cannot be
played and offers only **Record again** and **Discard**: it is never sent. The panel's player is
the browser's own video player. A recording stops by itself at the plan's time limit, or
one 8 MiB part before the largest upload the intake allows; either way it goes to `review`, and
the panel says which limit stopped it.

Each organization's ID is shown in Probara under **Vis → Settings**, next to the recording domains,
where the domains are added (no DNS record is needed). Every intake request carries the
organizations in the `probara-organizations` header, joined by commas. The intake answers a page
only for a link of one of the organizations it names, and only when the page is on a recording
domain of that organization (or on `localhost`, `127.0.0.1` and `[::1]`). When the link gets no
answer and the page is on another origin than `apiOrigin`, the recorder ends in `failed` and the
panel names both causes: the page's domain must be a recording domain of the organization in
Probara, and the page must name the organization in the recorder's `organizations` option. An
intake request with no answer
in time (2 minutes for an upload, 30 seconds for the others) counts as a failure: a part is
retried, anything else ends in `failed`.

## `createReporter(options)`

Starts in-app reporting on the page with a widget key. It reads the widget's configuration
(`GET /api/v1/public/vis-widget/<key>`, kept in `sessionStorage` for five minutes per key), and
when the widget keeps an instant replay and the browser can (`MutationObserver`,
`CompressionStream`, shadow DOM), it starts buffering once the page is idle
(`requestIdleCallback`, or two seconds after creation where it is missing). Returns the
`Reporter`, the same one when called again until it is destroyed, or `null` with one console
warning when `widgetKey` is not a widget key, `organizations` is not valid, or `apiOrigin` is not
an http(s) URL. Never throws.

### `ReporterOptions`

Every `RecorderOptions` option applies, with the same meaning, except `folder` (the widget key sets
the folder in Probara) and `onStateChange`'s type (`title` and `reference` set the Vis's own; there
is no link to override), plus:

| Option          | Type                                                                        | Default  | Meaning                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `widgetKey`     | `string`                                                                    | required | The widget key, `pvk_...`, from **Vis → Settings → In-app reporting**.                                                                                                                 |
| `reporterToken` | `() => string \| null \| Promise<string \| null>`                           | none     | The signed-in reporter's token (`signReporterToken`). Called once per report; sent in the `probara-reporter` header of its start. A throw, `null` or no answer within 30 s: no header. |
| `launcher`      | `boolean \| { position?: 'bottom-right' \| 'bottom-left'; label?: string }` | `false`  | A floating button that opens the panel; `bottom-right` and "Report a problem" (in the panel's language) unless given.                                                                  |
| `onStateChange` | `(state: ReporterState) => void`                                            | none     | Called on each change of state.                                                                                                                                                        |
| `onReport`      | `(report: SentReport) => void`                                              | none     | Called once for each report Probara received: from the panel (an instant replay or a screen recording) or from `sendInstantReplay`.                                                    |

The launcher shows the Probara mark beside its label. Its colours are the page's CSS custom
properties `--probara-vis-accent` (background) and `--probara-vis-accent-contrast` (text and
mark); unless set, the panel's card and text colours, which follow the page's `color-scheme`. Set
both together: with only the background, the text keeps the panel's colour. It is hidden
while the panel is open, and on a browser that can neither record the screen nor keep an instant
replay.

### `Reporter`

| Member                        | Meaning                                                                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                       | The current `ReporterState`.                                                                                                                                                                                                                                                       |
| `open(mode?)`                 | Opens the panel. No mode: it offers **Send what just happened** (only with an instant replay) and **Record from the start**. `'instant-replay'`: the review at once (or the choice, without one). `'record'`: a recording. Does nothing while the panel is open or once destroyed. |
| `close()`                     | Closes the panel; a report in progress is discarded and its submission aborted.                                                                                                                                                                                                    |
| `sendInstantReplay(request?)` | Sends the instant replay in the background, without the panel; see below.                                                                                                                                                                                                          |
| `destroy()`                   | Closes the panel, stops every capture (the page's `fetch`, `XMLHttpRequest`, console and `WebSocket` are put back), removes the launcher; `state` becomes `closed`.                                                                                                                |

### `sendInstantReplay(request?)`

For a page that collects the report in its own form: when the form is submitted, the instant
replay is sent in the background, with no panel and no state change, while the user keeps using the
page. `request.description` is the report's **What happened?** (plain text, cut at 2,000
characters).

What is sent is taken at the call: what happened up to it, the metadata of that moment, nothing
after. Buffering then starts over, so the next report does not repeat this one. The instant replay
stops while the panel records; when the call comes less than five minutes after the panel closed,
it sends what happened before the panel opened and what happened since it closed, as one replay
(the screen recording is its own Vis).

It returns a promise that never rejects and resolves to an `InstantReplayResult`:

| `status`                        | Meaning                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `sent`                          | Probara received it: `kind` (`'replay'`), `visUlid` and `url`, the address that opens the Vis in Probara.                                |
| `no-replay`                     | Nothing to send: the widget keeps no instant replay, the browser cannot, or buffering has not started yet.                               |
| `busy`, `unavailable`, `failed` | As the panel's states of the same names (see [Refusals](#refusals)), with `refusal` when the widget gave one; the submission is aborted. |
| `cancelled`                     | `destroy()` was called or the page was left meanwhile; the submission is aborted.                                                        |

Leaving the page cancels a send still in progress, so keep the page open until the promise
settles (for example with a `beforeunload` prompt). Each call is one report: it counts towards
the widget's **Recordings per hour**.

`SentReport`, the `sent` result and what `onReport` gets, is `{ status: 'sent', kind: 'replay' | 'video', visUlid, url }`;
`url` is `<apiOrigin>/vis/<visUlid>`.

### `ReporterState`

Every `RecorderState` of a recording from the start, and:

| State           | Meaning                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`          | The panel is closed; the instant replay, when the widget keeps one, is buffering.                                                                  |
| `choosing`      | The panel offers what to send.                                                                                                                     |
| `replay-review` | The instant replay is reviewed: its time span and page, and **What happened?** (up to 2,000 characters), then **Send** or **Discard** (confirmed). |

An instant replay that is sent goes through `sending` to `done`; one that fails ends in
`failed` (its submission aborted), `busy` or `unavailable`. `closed` follows `destroy()`. Closing
the panel from any state goes back to `idle` and starts buffering again, except closing the
review (the panel's **Close** or `close()` in `replay-review`): the instant replay never stopped
buffering, so the next open shows what happened up to then, as the first did, and nothing typed is
kept. A recording from the start stops the instant replay while it runs.

### What a report sends

Nothing is uploaded before the user sends. A report starts a submission with `kind`
(`replay` or `video`), the description, the page, its environment, the capture time and the
metadata of the moment the panel took the replay. An instant replay then uploads the replay
events as gzip-compressed NDJSON in parts (`kind: 'replay'`), the console, network and user
events streams, and finalizes with the time the replay covers: from its first event to the moment it
was taken. Every console, network and user event is timed (`t`) from that first event, and those
older than it are left out, so each one falls where it happened on the replay. A recording from the start is a
recording link's recording, through the widget's intake.

What is buffered: the replay of `@probara/vis-capture/replay` in `rolling` mode (about five
minutes within 16 MiB, paused while the page stays busy past `REPLAY_BUDGET`, three windows of 2 s
in a row with over 100 ms of main-thread time on DOM changes each, until it calms down, with a [`probara/replay-paused`](../../vis-capture/docs/replay.md#pause-on-a-busy-page) custom
event where it paused; the events sent end with a `probara/replay-health` custom
event, the replay's [health](../../vis-capture/docs/replay.md#health)), and the console, network and user events of
the last five minutes, at most 1,000 console entries (1 MiB), 1,000 requests (8 MiB) and 2,000
user events (1 MiB). The automatic blur, the `blur` option and the sanitizers apply to all of it;
buffering changes nothing on screen.

### Refusals

| Answer of the widget intake                   | State         | The panel says                                                          |
| --------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| 401 `reporter_required`                       | `unavailable` | Sign in to report a problem.                                            |
| 401 `invalid_reporter` (any `details.reason`) | `unavailable` | Your session could not be verified. Reload the page and try again.      |
| 429, `details.reason` `hourly_cap`            | `busy`        | Too many reports were sent in the last hour. Try again later.           |
| 429, `details.reason` `too_many_open`         | `busy`        | You have too many reports still being sent. Try again when they finish. |
| 429, `details.reason` `rate_limited`          | `busy`        | Too many requests right now. Try again in a few minutes.                |
| 404, or 422                                   | `unavailable` | Reporting a problem is not available right now.                         |

Spanish (`locale: 'es'`) has its own copy of every message.

## `signReporterToken(secret, claims?)`

From `@probara/vis/reporter-token`, for your backend only (Web Crypto: Node 20+, Deno, Bun and
Workers). Signs a compact HS256 JWS with the UTF-8 bytes of the widget's whole signing secret
(`pvs_...`). Its header is `{ alg: 'HS256', typ: 'JWT', kid }`, `kid` the secret's version; its
claims are `aud` (the widget, read from the secret), `iat`, `exp` and the claims given. Returns a
promise of the token; rejects with a `TypeError`, which never names the secret, when the secret is
not a signing secret or a claim is outside these bounds:

| Claim              | Type                                          | Bounds                                                                             |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `sub`              | `string`                                      | 1 to 200 characters; the reporter's ID in your app.                                |
| `name`             | `string`                                      | 1 to 200 characters.                                                               |
| `email`            | `string`                                      | An email address.                                                                  |
| `attributes`       | `Record<string, string \| number \| boolean>` | Flat; at most 20 keys of 1 to 64 characters; strings up to 200 characters.         |
| `expiresInSeconds` | `number`                                      | A whole number from 1 to 3,600 (`REPORTER_TOKEN_MAX_EXPIRY_SECONDS`), the default. |

Every claim is optional: a token with none still verifies a report from a page before login.

## `isRecordingSupported()`

`true` when the browser can share the screen (`getDisplayMedia`), record it with `MediaRecorder`
as MP4 or WebM, compress with `CompressionStream` and attach a shadow root. Never throws.

## `metadata(provider)`

Registers a `MetadataProvider`, `() => Record<string, unknown>`, and returns the function that
unregisters it. Providers are called each time a Vis is captured on the page; their objects merge
in registration order, a later key winning. A provider that throws, returns anything but a JSON
object (a Promise included), or would take the whole over 10 KiB once serialized or deeper than 32
levels (an object of scalar values is 1 level, each object or array inside another adds one) is
skipped. While
at least one is registered, the page answers the metadata requests of the Probara Vis extension.

## Constants

| Export                  | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `RECORDING_TOKEN_PARAM` | `'probara-recording'`, the query parameter of a recording link token.                               |
| `BLUR_META_NAME`        | `'probara:blur'`, the `<meta>` name whose `content` is blurred.                                     |
| `PRIVACY_SELECTORS`     | The selectors blurred automatically: `[data-probara-blur]` and those of other session replay tools. |
| `VERSION`               | The version of the package.                                                                         |

`@probara/vis/reporter-token` exports `REPORTER_TOKEN_MAX_EXPIRY_SECONDS` (`3600`).

## Types

`ConsoleEntry`, `LogSanitizer`, `RequestSanitizer`, `ResponseSanitizer`, `WebSocketSanitizer`,
`SanitizableRequest`, `SanitizableResponse`, `SanitizableWebSocketMessage` and `UrlPattern` are
the capture engine's, re-exported for the sanitizers you write; `LauncherPosition`, `Locale`,
`MetadataProvider`, `Recorder`, `RecorderOptions`, `RecorderState`, `Refusal` (the refusal names of
the table above), `Reporter`, `ReporterMode` (`'instant-replay' | 'record'`), `ReporterOptions`,
`ReporterState`, `ReporterTokenProvider`, `InstantReplayRequest`, `InstantReplayResult` and `SentReport` are this package's; `@probara/vis/reporter-token` also
exports `ReporterClaims`.
