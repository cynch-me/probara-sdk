# @probara/vis-capture

The browser capture engine of [Probara Vis](https://probara.net): it records what happens on a
page while a bug is captured, redacts secrets before anything leaves the page, and writes the
diagnostics a Vis stores. The Probara Vis browser extension and the embeddable Probara Vis SDK both
run on it.

This release captures the **console**: every console level with its stack trace, uncaught errors
and unhandled promise rejections. Network, WebSocket and user-event capture come in later releases;
their entry types, guards and sanitizers are already here.

Browser code only: no runtime dependencies and no Node.js built-ins. It needs `CompressionStream`
(Chrome and Edge 80, Firefox 113, Safari 16.4) to gzip the diagnostics.

## Install

```bash
npm install @probara/vis-capture
```

Or load the script-tag build, which sets the global `ProbaraVisCapture`:

```html
<script src="https://cdn.jsdelivr.net/npm/@probara/vis-capture/dist/vis-capture.iife.js"></script>
```

The package ships `dist/index.js` (an ES module, with its types in `dist/index.d.ts`) and
`dist/vis-capture.iife.js` (one minified file, also exported as `@probara/vis-capture/iife`).
Pin a version in the CDN URL in production.

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
`dropped(stream)`. Starting again after `stop()` begins a new recording with empty buffers.

## The diagnostics format

One JSON document per line (`toNdjson`), gzip-compressed (`gzipNdjson`), one file per stream.
`DIAGNOSTICS_FORMAT_VERSION` (now `1`) names the shapes below; `isConsoleEntry`,
`isNetworkEntry`, `isWebSocketMessageEntry` and `isUserEventEntry` check them at runtime.

| Entry                   | Fields besides `t` and `ts`                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ConsoleEntry`          | `level` (`log`, `info`, `warn`, `error`, `debug`, `trace`), `args` (serialized strings), `stack?`, `source?` (`url:line:column` of an uncaught error)                                                              |
| `NetworkEntry`          | `id`, `kind` (`fetch`, `xhr`, `beacon`, `resource`, `websocket`), `method`, `url`, `status?`, `requestHeaders`, `responseHeaders`, `requestBody?`, `responseBody?`, `durationMs?`, `timing?`, `error?`, `graphql?` |
| `WebSocketMessageEntry` | `socketId`, `direction` (`sent`, `received`), `data`                                                                                                                                                               |
| `UserEventEntry`        | `type` (`click`, `input`, `navigation`, `keypress`, `scroll`, `resize`, `visibility`), `target?` (`selector`, `text`, `tag`), `url`, `value?` (masked), `x?`, `y?`                                                 |

A body is `{ text?, truncated, size, omitted? }`: `size` is the whole body in bytes, and `omitted`
says why no text was kept (`too_large`, `binary`, `stream`, `opaque`, `unsupported`).

## Redaction and sanitizers

Built-in redaction replaces secrets with the literal `PROBARA_REDACTED`, always, after any
sanitizer of yours:

- the `Authorization`, `Proxy-Authorization`, `Cookie` and `Set-Cookie` headers, and every header
  whose name holds `auth`, `token`, `secret`, `api-key`, `session-id` and the like;
- `Bearer`, `Basic` and `Digest` credentials, JWT-looking tokens and well-known provider keys in
  any text;
- the values of credential-like keys (`password`, `token`, `secret`, `api_key`, `cvv`, `ssn`...)
  in JSON bodies at any depth, in query strings, form bodies and log lines;
- card numbers that pass the Luhn check, and US social security numbers.

Sanitizers are synchronous functions: return the (possibly modified) value to keep it, or `null`
to drop it. They fail closed: a sanitizer that throws or returns anything else gets the content it
guarded replaced with `PROBARA_SANITIZER_REDACTED`, never the original.

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
