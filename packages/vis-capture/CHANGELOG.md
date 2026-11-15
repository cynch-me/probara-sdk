# @probara/vis-capture

## 0.1.0

### Minor Changes

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`b2fc7ff`](https://github.com/cynch-me/probara-sdk/commit/b2fc7ff150dbe217043bee98363930b48c5225ff) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New package: the browser capture engine of Probara Vis. It records the console (every level, stack
  traces, uncaught errors and unhandled rejections), the network (fetch, XHR, beacons, resource
  loads, GraphQL operations and WebSocket messages), user events and the environment into a recording
  session with bounded buffers, each stream in time order (one `input` entry per typing burst), records the video of a stream the caller shares (WebM with VP9 or VP8
  where the browser can, MP4 with H.264 otherwise), with blur, and a DOM
  replay through the separate `@probara/vis-capture/replay` entry. It defines the diagnostics entry
  types with runtime guards, writes them as gzip-compressed NDJSON, and redacts secrets with built-in
  rules and fail-closed sanitizers. It ships as ES modules and as script-tag builds that set the
  globals `ProbaraVisCapture` and `ProbaraVisCaptureReplay`.

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`04b4718`](https://github.com/cynch-me/probara-sdk/commit/04b4718c80e2d87ff7417148792e96ad0eb76e39) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Custom metadata over DOM events: `answerMetadataRequests` answers on the page and
  `requestPageMetadata` reads from a content script, with JSON string details that cross script
  worlds, a versioned handshake, and the server's 10 KiB limit applied on both sides
  (`normalizeMetadata`, `MAX_METADATA_BYTES`). `createUserEventCapture` takes `ignore`, so a
  recorder's own controls stay out of the user events.

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`cd981b6`](https://github.com/cynch-me/probara-sdk/commit/cd981b6ab9f3be7d38a7c4475a2a976f6f594490) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Custom metadata keeps the server's depth limit too: `normalizeMetadata` refuses metadata nested
  more than `MAX_METADATA_DEPTH` (32) levels deep, the root object being level 1 and every object or
  array inside another adding one, as Probara counts it. The depth is checked with an explicit stack
  before anything serializes the value, so metadata nested thousands of levels deep is refused
  without overflowing the stack of the page. The walk follows what JSON sends, so a property JSON
  leaves out does not count and a top-level `__proto__` key, which Probara drops, is left out. The handshake answers `null` for such metadata, a reader
  ignores it, and a `metadata()` provider of `@probara/vis` that returns it is skipped.
