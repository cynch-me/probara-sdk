<p align="center">
  <a href="https://probara.net"><img src="https://raw.githubusercontent.com/cynch-me/probara-sdk/main/.github/assets/probara-mark.png" alt="Probara" width="120"></a>
</p>

<h1 align="center">@probara/vis-capture</h1>

<p align="center">The browser capture engine behind Probara Vis.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@probara/vis-capture"><img src="https://img.shields.io/npm/v/@probara/vis-capture?style=flat-square&color=5b3fd6&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@probara/vis-capture"><img src="https://img.shields.io/npm/dm/@probara/vis-capture?style=flat-square&color=5b3fd6" alt="npm downloads"></a>
  <a href="https://github.com/cynch-me/probara-sdk/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/cynch-me/probara-sdk/release.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/cynch-me/probara-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b3fd6?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/runtime-browser-5b3fd6?style=flat-square" alt="Runs in the browser">
</p>

<p align="center">
  <a href="#install"><b>Install</b></a>
  ·
  <a href="#what-it-captures"><b>What it captures</b></a>
  ·
  <a href="#the-diagnostics-format"><b>Diagnostics format</b></a>
  ·
  <a href="https://probara.net"><b>Probara</b></a>
  ·
  <a href="https://github.com/cynch-me/probara-sdk"><b>Probara SDK</b></a>
</p>

The browser capture engine of [Probara Vis](https://probara.net): it records what happens on a
page while a bug is captured, redacts secrets before anything leaves the page, and writes the
diagnostics a Vis stores. The Probara Vis browser extension and the embeddable Probara Vis SDK both
run on it.

It captures the **console** (every level with its stack trace, uncaught errors and unhandled
promise rejections), the **network** (fetch, XHR, beacons, resource loads, GraphQL operations and
WebSocket messages), **user events**, the **environment**, a **DOM replay** and the **video** of a
screen, window or tab the caller shares.

Browser code only: no Node.js built-ins. The main entry has no runtime dependencies; the DOM replay
recorder is the separate `@probara/vis-capture/replay` entry, which uses the recorder of
[rrweb](https://github.com/rrweb-io/rrweb) (`@rrweb/record`, MIT); the licence notices of what the replay script-tag
build bundles are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The package needs `CompressionStream` (Chrome and
Edge 80, Firefox 113, Safari 16.4) to gzip the diagnostics.

## Install

```bash
npm install @probara/vis-capture
```

Or load the script-tag build, which sets the global `ProbaraVisCapture`:

```html
<script src="https://cdn.jsdelivr.net/npm/@probara/vis-capture/dist/vis-capture.iife.js"></script>
```

The package ships `dist/index.js` (an ES module, with its types in `dist/index.d.ts`) and
`dist/vis-capture.iife.js` (one minified file, also exported as `@probara/vis-capture/iife`). The
replay entry ships the same way: `dist/replay.js` and `dist/vis-capture-replay.iife.js`, which sets
the global `ProbaraVisCaptureReplay` and is also exported as `@probara/vis-capture/replay/iife`.
Pin a version in the CDN URL in production.

## What it captures

| Capture                     | Start with                                                                 | Guide                                      |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Console                     | `createConsoleCapture`                                                     | [below](#record-the-console)               |
| Network and WebSockets      | `createNetworkCapture`, `createWebSocketCapture`                           | [docs/network.md](docs/network.md)         |
| User events and environment | `createUserEventCapture`, `collectEnvironment`                             | [docs/user-events.md](docs/user-events.md) |
| DOM replay                  | `createReplayRecorder` from `@probara/vis-capture/replay`                  | [docs/replay.md](docs/replay.md)           |
| Video and blur              | `createVideoRecorder`, `displayCaptureConstraints`, `createBlurController` | [docs/recording.md](docs/recording.md)     |
| Custom metadata             | `answerMetadataRequests`, `requestPageMetadata`                            | [below](#custom-metadata)                  |

`createUserEventCapture` also takes `ignore`, a function of an element: a click, typing, key or
scroll whose event path holds an element it returns `true` for is not recorded (a closed shadow
root is reached through its host), so a recorder's own controls stay out of the user events. When
it throws, the event is left out too.

## Record the console

```ts
import { createConsoleCapture, createRecordingSession, gzipNdjson } from '@probara/vis-capture';

const session = createRecordingSession();
const capture = createConsoleCapture(session, {
  // Optional: return the entry (changed or not) to keep it, or null to drop it.
  logSanitizer: (entry) => (entry.args[0]?.startsWith('[debug]') ? null : entry),
});

session.start();
capture.start();
// ... the user reproduces the bug ...
capture.stop();
session.stop();

const consoleFile = await gzipNdjson(session.entries('console')); // gzip-compressed NDJSON bytes
```

Console capture calls the original console method exactly once per call, never throws into the
page, does nothing more when started twice, and puts the original methods back on `stop()` (a
wrapper another script installed after it stays in place). Each argument is serialized to a string
of at most 5000 characters: objects as JSON, with cycles, DOM nodes, errors, `bigint` and functions
written readably, and depth and key limits (`serialize` option).

## The session

`createRecordingSession()` holds one recording: `start()`, `stop()`, and one bounded buffer per
stream (`console`, `network`, `events`). Every entry carries `t`, the milliseconds since
`start()`, and `ts`, the epoch milliseconds. When a stream reaches its entry or byte limit
(`DEFAULT_BUFFER_LIMITS`, or the `limits` option), the oldest entries are dropped and counted by
`dropped(stream)`. Each stream is kept in `t` order, whatever order its entries are recorded in
(a request is recorded when it ends, typing once it pauses); entries with the same `t` keep the
order they were recorded in. Starting again after `stop()` begins a new recording with empty buffers.

A stream can also keep a time window: with `maxAgeMs` in its limits, an entry older than that is
dropped (and counted) when another is recorded and when the stream is read, measured from now
while recording and from the stop once stopped. A buffer that runs all the time, such as an
instant replay of the last five minutes, uses it:

```ts
const window = { maxAgeMs: 5 * 60_000 };
const session = createRecordingSession({
  limits: { console: window, network: window, events: window },
});
```

No stream has a time window unless given.

## The diagnostics format

One JSON document per line (`toNdjson`), gzip-compressed (`gzipNdjson`), one file per stream; the
events of a replay are written the same way.
`DIAGNOSTICS_FORMAT_VERSION` (now `1`) names the shapes below; `isConsoleEntry`,
`isNetworkEntry`, `isWebSocketMessageEntry` and `isUserEventEntry` check them at runtime.

| Entry                   | Fields besides `t` and `ts`                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleEntry`          | `level` (`log`, `info`, `warn`, `error`, `debug`, `trace`), `args` (serialized strings), `stack?`, `source?` (`url:line:column` of an uncaught error)                                                       |
| `NetworkEntry`          | `id`, `kind` (`fetch`, `xhr`, `beacon`, `resource`, `websocket`), `method`, `url`, `status`, `requestHeaders`, `responseHeaders`, `requestBody`, `responseBody`, `durationMs`, `timing`, `error`, `graphql` |
| `WebSocketMessageEntry` | `socketId`, `direction` (`sent`, `received`), `data`                                                                                                                                                        |
| `UserEventEntry`        | `type` (`click`, `input`, `navigation`, `keypress`, `scroll`, `resize`, `visibility`), `target?` (`selector`, `text`, `tag`), `url`, `value?` (masked, or the key of a keypress), `x?`, `y?`                |

The network fields after `responseHeaders` are always present and `null` when there is no value. A
body is `{ text, truncated, size, omitted }`: `size` is the whole body in bytes (`null` when
unknown), and `omitted` says why no text was kept (`too_large`, `binary`, `stream`, `opaque`,
`unsupported`); a body never has both `text` and `omitted`. An entry is recorded when its request
ends and goes into the stream in `t` order, so a network file lists requests in the order they
started.

## Custom metadata

A site describes the session it is capturing (a user id, a plan, a feature flag) as custom
metadata: a JSON object nested at most `MAX_METADATA_DEPTH` (32) levels deep and of at most
`MAX_METADATA_BYTES` (10 KiB) once serialized, the limits a Vis keeps. An object of scalar values
is 1 level deep, and each object or array inside another adds a level. Metadata is checked as the
JSON it is sent as: a property JSON leaves out (a named property of an array, one of a boxed
number) does not count, and a top-level `__proto__` key, which Probara drops, is left out. The page answers requests
for it over DOM events on the window, and the capture asks when it makes a Vis. The embeddable SDK [`@probara/vis`](https://github.com/cynch-me/probara-sdk/blob/main/packages/vis/README.md)
answers for the site through its `metadata()` API; the extension reads with `requestPageMetadata`.

```ts
import { answerMetadataRequests, requestPageMetadata } from '@probara/vis-capture';

// The page: answers every request with what the function returns now.
const stop = answerMetadataRequests(() => ({ userId: 'u-42', plan: 'pro' }));

// The reader (a content script of the extension, on the same window):
const metadata = await requestPageMetadata({ timeoutMs: 500 }); // { userId: 'u-42', plan: 'pro' } or null
```

The handshake is versioned (`METADATA_PROTOCOL_VERSION`, now `1`). The reader dispatches
`METADATA_REQUEST_EVENT` (`probara-vis:metadata-request`) with a random request id; the page
answers with `METADATA_RESPONSE_EVENT` (`probara-vis:metadata-response`) carrying that id and the
metadata, or `null`. Both details are JSON strings, never objects, so they cross between a page
and an extension's content script, whose worlds share no objects. Each side treats what it receives
as untrusted: a detail of another type, another version, another request's id, malformed JSON or
anything over the limits is ignored, and metadata that is not a JSON object within the limit is
`null`. A page function that throws answers `null`. `requestPageMetadata` never rejects: it
resolves `null` when nothing valid answers within `timeoutMs` (`DEFAULT_METADATA_TIMEOUT_MS`, 500).
`normalizeMetadata(value)` applies the same rule to any value.

## Redaction and sanitizers

Built-in redaction replaces secrets with the literal `PROBARA_REDACTED`, always, after any
sanitizer of yours:

- the `Authorization`, `Proxy-Authorization`, `Cookie` and `Set-Cookie` headers, and every header
  whose name holds `auth`, `token`, `secret`, `api-key`, `session-id` and the like;
- `Bearer`, `Basic` and `Digest` credentials, an `Authorization` value with any other scheme
  (the AWS SigV4 `Credential` and `Signature` parts included), JWT-looking tokens and the
  password of a URL in any text;
- well-known provider keys in any text: Stripe, GitHub (`ghp_`, `github_pat_`...), AWS access key
  ids, Slack, OpenAI (`sk-proj-`), Anthropic (`sk-ant-`), Google (`AIza`), GitLab (`glpat-`), npm
  (`npm_`) and SendGrid (`SG.`);
- the values of credential-like keys (`password`, `token`, `secret`, `api_key`, `signature`,
  `sig`, `cvv`, `ssn`...) in JSON bodies at any depth, in query strings, form bodies and log
  lines, also as bracketed form field names (`user[password]`, `a[b][token]`, percent-encoded
  `user%5Bpassword%5D`) and inside percent-encoded text such as JSON in a query string
  (`variables=%7B%22token%22%3A…`);
- session cookies by name: `PHPSESSID`, `laravel_session`, `_app_session`, `connect.sid`,
  `JSESSIONID`, `ASP.NET_SessionId` and other names holding `session_id` or `sessid`;
- card numbers that pass the Luhn check, and US social security numbers.

Sanitizers are synchronous functions: return the (possibly modified) value to keep it, or `null`
to drop it. They fail closed: a sanitizer that throws or returns anything else gets the content it
guarded replaced with `PROBARA_SANITIZER_REDACTED`, never the original.

A console entry keeps at most `MAX_CONSOLE_STACK_LENGTH` (10000) characters of its `stack` and
`MAX_CONSOLE_SOURCE_LENGTH` (2000) of its `source`; a longer one is cut and ends with `…`.

| Sanitizer            | Gets                             | Applied by               |
| -------------------- | -------------------------------- | ------------------------ |
| `logSanitizer`       | the `ConsoleEntry`               | `sanitizeConsoleEntry`   |
| `requestSanitizer`   | `{ url, method, headers, body }` | `sanitizeNetworkEntry`   |
| `responseSanitizer`  | `{ url, status, headers, body }` | `sanitizeNetworkEntry`   |
| `webSocketSanitizer` | `{ socketId, direction, data }`  | `sanitizeWebSocketEntry` |

`null` from `requestSanitizer` or `responseSanitizer` drops the whole network entry.
`redactString`, `redactHeaders` and `redactBody` expose the built-in rules.

## License

Apache-2.0
