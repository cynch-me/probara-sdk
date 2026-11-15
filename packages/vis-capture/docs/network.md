# Network and WebSocket capture

`createNetworkCapture` records the requests a page makes; `createWebSocketCapture` records its
WebSockets and their messages. Both write into a [recording session](../README.md#the-session):
requests go to its `network` stream as `NetworkEntry` lines, WebSocket messages as
`WebSocketMessageEntry` lines in the same stream.

```ts
import {
  createNetworkCapture,
  createRecordingSession,
  createWebSocketCapture,
  gzipNdjson,
} from '@probara/vis-capture';

const session = createRecordingSession();
const sanitizers = {
  // Optional, synchronous: return the value (changed or not) to keep it, or null to drop the entry.
  requestSanitizer: (request) => ({
    ...request,
    headers: { ...request.headers, 'x-user': '<id>' },
  }),
  webSocketSanitizer: (message) => (message.data.includes('"type":"ping"') ? null : message),
};
// Leave out the requests that upload the recording itself.
const ignoreUrls = ['https://api.probara.net/'];
const network = createNetworkCapture(session, { ...sanitizers, ignoreUrls });
const sockets = createWebSocketCapture(session, { ...sanitizers, ignoreUrls });

session.start();
network.start();
sockets.start();
// ... the user reproduces the bug ...
network.stop();
sockets.stop();
session.stop();

const networkFile = await gzipNdjson(session.entries('network'));
```

Stop the captures before the session: `sockets.stop()` records the sockets still open, and a
request still in flight is recorded when it ends, only while the session is recording.

## What is recorded

| `kind`      | From                     | Notes                                                                                                                                |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `fetch`     | `fetch()`                | Request and response headers and bodies, status, duration, resource timing                                                           |
| `xhr`       | `XMLHttpRequest`         | The same; headers set with `setRequestHeader`                                                                                        |
| `beacon`    | `navigator.sendBeacon()` | Request body only; `status` and `durationMs` are `null`, `error` is set when the browser did not queue it                            |
| `resource`  | The Performance API      | Scripts, styles, images, fonts and other loads: URL, status where the browser reports it, duration, timing; no headers and no bodies |
| `websocket` | `new WebSocket()`        | One entry per socket, recorded when it closes; its messages are separate entries                                                     |

Every network entry holds every field; a field without a value is `null` (the shape the Probara
API validates). `t` and `ts` are when the request started. An entry is recorded when its request
ends, and goes into the stream in `t` order: the stream lists requests in the order they started,
whatever order they ended in.

- `status` is `null` when no response arrived (a network error, an abort) and for an opaque
  (`no-cors`) response.
- `error` is `TypeError: Failed to fetch`, `AbortError: …`, `Network error`, `Aborted` or
  `Timeout` (XHR), or why a body could not be read.
- `durationMs` runs from the call until the response body was read, or until the response
  headers when the body was not read.
- `timing` comes from the browser's `PerformanceResourceTiming` entry for the request, when
  there is one: `startMs` (before the request was sent), `dnsMs`, `connectMs`, `tlsMs`,
  `ttfbMs` (request sent to first byte) and `responseMs` (first to last byte). Cross-origin
  servers that do not send `Timing-Allow-Origin` hide these phases, and `timing` is `null`.

## Bodies

A body is `{ text, truncated, size, omitted }`. Text is kept up to `maxBodyBytes` UTF-8 bytes;
past that, `text` holds the start, `truncated` is `true` and `size` is the whole body. A body
that is not kept has `text: null` and its reason in `omitted`; `text` and `omitted` are never
both set.

| `omitted`     | When                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `binary`      | A non-text content type (images, `application/octet-stream`…), an `ArrayBuffer` or typed array sent without a text content type, or bytes that are not UTF-8 |
| `stream`      | `text/event-stream` and `multipart/x-mixed-replace` responses, a `ReadableStream` request body, or a body still arriving after `bodyReadTimeoutMs`           |
| `too_large`   | A body larger than `maxBodyReadBytes`: reading stops there                                                                                                   |
| `opaque`      | A `no-cors` response, which the page cannot read either                                                                                                      |
| `unsupported` | A body of a type it cannot describe                                                                                                                          |

`size` is `null` when it is not known (a body not read to the end without a `Content-Length`).
Form data is kept as `name=value` pairs, a file as `[file <name>, <n> bytes]`, with `size`
`null`.

The response body is read from `response.clone()`, taken before the page gets the response: the
page's own body is never consumed, delayed or changed. A clone that is not read to the end is
cancelled, which leaves the page's body unaffected.

## GraphQL

A request carrying a GraphQL operation gets `graphql: { operationName, operationType, hasErrors }`.
The operation is read from a JSON body (`query` and `operationName`), a batched array (every
operation name, comma-separated, with the type of the first), an `application/graphql` body, or
the `query`, `operationName` and `extensions` parameters of a GET. A persisted query that sends
only its name has `operationType: null`. `hasErrors` is `true` when the response body holds a
non-empty `errors` list, whatever the HTTP status (most servers answer errors with 200); it is
`false` when the response body was not kept. `graphqlOperation` and `graphqlHasErrors` expose
the detection.

## WebSockets

The `WebSocket` constructor is replaced by a wrapper: `instanceof WebSocket`, the static
constants, `WebSocket.prototype` and subclasses behave as before, and the page's own listeners
receive every event unchanged. The socket's entry has `status: 101` once it opened (`null` when
it never did), the requested and accepted subprotocols as `sec-websocket-protocol` headers,
`timing.connectMs` (until it opened), and `durationMs` until it closed (`null` for a socket
still open when capture stopped). `error` is `WebSocket error (close code <n>)` after an error
event, `Closed with code <n>: <reason>` after a close with a code other than 1000 or 1005, and
`null` otherwise.

Each message is one `WebSocketMessageEntry` with `socketId` (the socket entry's `id`),
`direction` (`sent` or `received`) and `data`: text up to `maxMessageBytes` UTF-8 bytes,
followed by `… [truncated, <n> bytes]` when cut; a binary message is written as
`[binary message, <n> bytes]`. Only sockets opened after `start()` are recorded.

## Options

| Option               | Default      | Of                       |
| -------------------- | ------------ | ------------------------ |
| `requestSanitizer`   | none         | both                     |
| `responseSanitizer`  | none         | `createNetworkCapture`   |
| `webSocketSanitizer` | none         | `createWebSocketCapture` |
| `ignoreUrls`         | `[]`         | both                     |
| `maxBodyBytes`       | 65,536       | `createNetworkCapture`   |
| `maxBodyReadBytes`   | 1,048,576    | `createNetworkCapture`   |
| `bodyReadTimeoutMs`  | 10,000       | `createNetworkCapture`   |
| `maxMessageBytes`    | 65,536       | `createWebSocketCapture` |
| `target`             | `globalThis` | both                     |

`ignoreUrls` takes strings, matched as the start of the absolute URL, and regular expressions,
tested against it. `target` is the window to capture, such as a same-origin frame's
`contentWindow`. On a socket, `requestSanitizer` sees its URL and requested subprotocol headers.
`DEFAULT_BODY_LIMITS` holds the three body defaults.

## Never breaking the page

Capture never changes what the page's calls return, throw or receive: `fetch` resolves to the
same `Response` and rejects with the same error, `send` and `sendBeacon` get the same arguments
and return the same value, and an error inside capture (or in a sanitizer) is swallowed. A request
a sanitizer makes is not recorded. `stop()` puts back exactly what `start()` replaced (an own
property, or none over an inherited one), and only where the current value is still the capture's
own wrapper, so a wrapper another script installed later stays in place; the capture's wrapper,
inactive, then calls straight through. Starting twice does nothing more.
