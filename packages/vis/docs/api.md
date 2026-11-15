# API reference

Everything `@probara/vis` exports, from `import { ... } from '@probara/vis'` or the
`ProbaraVis` global of the script-tag build. See the [README](../README.md) for the guide.

## `startRecorderFromUrl(options?)`

Reads a recording link token from the page's address (`?probara-recording=<token>`), removes the
parameter from the address bar with `history.replaceState` (the rest of the address and the
history state are kept), and opens the recorder for it. Returns the `Recorder`, or `null` when
the address carries no valid token or `apiOrigin` is not an http(s) URL. Where the browser
cannot record, the recorder opens in the `unsupported` state and sends nothing. The parameter is
removed even when the token is refused. Never throws.

## `startRecorder(token, options?)`

Opens the recorder for a token your code already holds. Returns the `Recorder`, or `null` as
above. While a recorder is open, both functions return that one: a page has one recorder at a time.

### `RecorderOptions`

| Option               | Type                    | Default                | Meaning                                                                         |
| -------------------- | ----------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `apiOrigin`          | `string`                | the page's origin      | The origin of the Probara API; anything after the origin is ignored.            |
| `title`              | `string`                | the link's title       | The title of this recording; the visitor may still change it.                   |
| `reference`          | `string`                | the link's reference   | Free text kept on the Vis, up to 200 characters.                                |
| `folder`             | `string`                | the link's folder      | The ULID of a folder that is not private.                                       |
| `microphone`         | `boolean`               | the link's default     | Whether the microphone starts on.                                               |
| `blur`               | `readonly string[]`     | none                   | CSS selectors blurred while recording, on top of the automatic ones.            |
| `ignoreUrls`         | `readonly UrlPattern[]` | none                   | Requests left out of the network capture (a string prefix or a RegExp).         |
| `logSanitizer`       | `LogSanitizer`          | none                   | Gets each console entry; returns it (changed or not) or `null` to drop it.      |
| `requestSanitizer`   | `RequestSanitizer`      | none                   | Gets `{ url, method, headers, body }`; `null` drops the whole request.          |
| `responseSanitizer`  | `ResponseSanitizer`     | none                   | Gets `{ url, status, headers, body }`; `null` drops the whole request.          |
| `webSocketSanitizer` | `WebSocketSanitizer`    | none                   | Gets `{ socketId, direction, data }`; `null` drops the message.                 |
| `locale`             | `'en' \| 'es'`          | the browser's language | The language of the panel: Spanish for `es` and its regions, English otherwise. |
| `onStateChange`      | `(state) => void`       | none                   | Called on each change of state.                                                 |

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
| `sending`     | The recording ended; the rest is being uploaded and the Vis finalized.                                  |
| `done`        | The Vis was finalized.                                                                                  |
| `failed`      | The link could not be read, or the recording could not be sent; its submission was aborted.             |
| `closed`      | The recorder was closed, or the page went away (its submission, if any, was aborted).                   |
| `unsupported` | The browser cannot record the screen (see `isRecordingSupported()`); nothing was sent.                  |

A visitor who cancels the share picker goes back to `ready`; so does a discard. A recording stops
by itself at the plan's time limit, or one 8 MiB part before the largest upload the intake allows;
either way it is sent, and the panel says which limit stopped it. An intake request with no answer
in time (2 minutes for an upload, 30 seconds for the others) counts as a failure: a part is
retried, anything else ends in `failed`.

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

## Types

`ConsoleEntry`, `LogSanitizer`, `RequestSanitizer`, `ResponseSanitizer`, `WebSocketSanitizer`,
`SanitizableRequest`, `SanitizableResponse`, `SanitizableWebSocketMessage` and `UrlPattern` are
the capture engine's, re-exported for the sanitizers you write; `Locale`, `MetadataProvider`,
`Recorder`, `RecorderOptions` and `RecorderState` are this package's.
