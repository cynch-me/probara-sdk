# @probara/vis-capture

## 0.4.0

### Minor Changes

- [#35](https://github.com/cynch-me/probara-sdk/pull/35) [`62c36c3`](https://github.com/cynch-me/probara-sdk/commit/62c36c39eb178e256670bd10feba9e966f3bbbcb) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - A replay keeps only the address of a linked stylesheet the Probara servers can download, instead of
  inlining its CSS into every full snapshot: about 40 ms of main-thread time and 1.3 MB less per
  snapshot for a typical Angular app. It still inlines them on a page the servers never reach
  (`localhost`, private hosts and addresses, other ports) and when a stylesheet is larger than the
  2 MiB they keep. `inlineStylesheets` overrides the choice, for example for stylesheets behind a
  sign-in.

- [#35](https://github.com/cynch-me/probara-sdk/pull/35) [`ed77755`](https://github.com/cynch-me/probara-sdk/commit/ed77755f5e91d8471d8586f58eed1193d0c09205) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - The instant replay no longer pauses on the burst of a navigation. A replay budget now pauses only
  once the page stayed busy for `busyWindows` windows in a row (`REPLAY_BUDGET`: three windows of
  2 s over 100 ms each), no longer compares against the longest full snapshot so far, and resumes at
  the end of the first window whose changes fit the budget again, with `pauseMs` as the longest
  wait. BREAKING: `ReplayBudget` requires `busyWindows`, and the `probara/replay-paused` payload
  carries `busyWindows` and `resumeWithinMs` (the longest wait) in place of `resumeInMs`.

## 0.3.0

### Minor Changes

- [#33](https://github.com/cynch-me/probara-sdk/pull/33) [`8e11ce4`](https://github.com/cynch-me/probara-sdk/commit/8e11ce485d78532abbf5404f87f876be39564211) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - A DOM replay on a busy page pauses instead of stopping for the rest of the session. `budget`
  (`REPLAY_BUDGET`, 100 ms of main-thread time on DOM changes in any 2 s, for the instant replay of
  `@probara/vis`) replaces `mutationLimit`: once the changes cost more than it and than a full
  snapshot, the replay marks a `probara/replay-paused` event, records nothing for 10 s, and resumes
  from a new full snapshot, waiting twice as long after each pause that follows, up to the checkout
  interval. `paused` and `health.pauses` tell it.
  `mutationLimit`, `REPLAY_MUTATION_LIMIT`, `REPLAY_STOPPED_TAG`, `ReplayStopReason` and
  `stopReason` are removed. An Angular table re-render that stopped the instant replay at once now
  records through.

- [#33](https://github.com/cynch-me/probara-sdk/pull/33) [`05a7b0c`](https://github.com/cynch-me/probara-sdk/commit/05a7b0cdaaef5d8345f5e3d086ecb1f154d09b72) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - The DOM replay no longer records HTML comments, in both modes: the anchor comments frameworks such as
  Angular leave around every template were about a quarter of the mutations on a busy page. A node
  inserted next to one still replays in its place.

- [#33](https://github.com/cynch-me/probara-sdk/pull/33) [`7b95bf2`](https://github.com/cynch-me/probara-sdk/commit/7b95bf2d4828bba777dd591b864e69a726732765) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - The DOM replay measures its own health: `health` reports why it stopped, its checkouts, the size
  held and recorded, its largest mutation batch and the main-thread time rrweb and the recorder spent,
  and `coverage` gives the span held without reading the events. `replayHealthEvent` turns the
  health into a `probara/replay-health` custom event, which `@probara/vis` adds at the end of every
  instant replay it sends. Held events are kept as JSON text.

- [#33](https://github.com/cynch-me/probara-sdk/pull/33) [`668f113`](https://github.com/cynch-me/probara-sdk/commit/668f1138c0dfa70d5f2dbd82239d5090d0569396) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - A rolling DOM replay keeps the newest segments that reach back `lookbackMs` (the checkout interval
  unless given), within `maxSize` (`REPLAY_MAX_SIZE`, 16 MiB of JSON): past it the oldest segments
  are dropped, and a segment holding more than half of it starts a new one early, so a busy page keeps
  recording within a bounded amount of memory.

## 0.2.0

### Minor Changes

- [#23](https://github.com/cynch-me/probara-sdk/pull/23) [`f7c0004`](https://github.com/cynch-me/probara-sdk/commit/f7c00042ae7ccbd4d0177435f4cd74f2aac12439) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - In-app reporting: `createReporter` starts Probara Vis in your own app with a widget key, so your
  users report a bug from whatever page they are on. The panel offers **Send what just happened**,
  an instant replay of the last minutes (a rolling DOM replay with the console, network and user
  events of the last five minutes, buffered in memory and sent only when the user sends it), and
  **Record from the start**, the screen recording of recording links. Open it from your own button
  (`reporter.open()`) or an optional floating launcher coloured by `--probara-vis-accent` and
  `--probara-vis-accent-contrast`; the script tag reads `data-widget-key` and `data-launcher`. The
  replay recorder loads lazily, after the page is idle, and only for a widget that keeps an instant
  replay. Verified reporters: `signReporterToken` from `@probara/vis/reporter-token` signs the
  reporter's token on your backend (Web Crypto only), and the panel tells each refusal of the widget
  intake in English and Spanish. Recording links work as before.

  `@probara/vis-capture`: the session's buffer limits take a time window (`maxAgeMs`); the replay
  recorder takes a `mutationLimit` and says why it stopped (`stopReason`, `REPLAY_MUTATION_LIMIT`);
  `createBlurController({ render: false })` tracks what is blurred without changing how the page looks.

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
