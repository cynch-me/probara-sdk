# @probara/vis

## 0.2.0

### Minor Changes

- [#21](https://github.com/cynch-me/probara-sdk/pull/21) [`03ff7e1`](https://github.com/cynch-me/probara-sdk/commit/03ff7e13035fa29aaf99523e0c7ba59bd4de6343) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - **Breaking:** the recorder now requires the `organizations` option (`data-organizations` on the
  script tag, separated by spaces or commas): the IDs of the Probara organizations the page serves,
  1 to 20, shown in Probara under Vis settings next to the recording domains. Without valid
  organizations, `startRecorder` and `startRecorderFromUrl` return `null` and log one console
  warning, and `startRecorderFromUrl` leaves the token in the address. Every intake request names
  them in the `probara-organizations` header, and the intake serves a link only for one of them, so
  another organization cannot record visitors through your page. Recording domains are declared in
  Probara with no DNS record, and the panel's refusal message names both causes: the page's domain
  must be a recording domain of the organization, and the page must name the organization.

## 0.1.0

### Minor Changes

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`4e43265`](https://github.com/cynch-me/probara-sdk/commit/4e432652767a7ba58e8038288945919c43adfd3b) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New package: the browser SDK of Probara Vis for a customer's own site. `startRecorderFromUrl()`
  opens an in-page recorder when a visitor arrives through a recording link
  (`?probara-recording=<token>`, taken out of the address bar at once): a "Ready to record?" card
  with Start recording and a microphone toggle; the visitor records the current tab with pause,
  resume, stop and discard, then watches the recording in the panel, which can be scrubbed at once,
  and chooses Send, Record again or Discard (both confirmed); a recording the panel cannot play
  offers Record again and Discard only. Only on Send are the video (uploaded in parts while it records), the
  console, network and user events and the environment finalized as a Vis under the link's title,
  never longer than the plan's limit. A recording about to outgrow the largest upload stops by
  itself, and the panel says which limit stopped it.
  Every intake request has a time limit; the finalize's grows with the size of the video. Every ending but a finished one aborts the submission. A
  browser that cannot record the screen gets a panel that says so, and nothing is sent. `metadata(provider)` registers custom metadata for the Vises
  captured on the page, read by the recorder and by the extension. Elements marked with
  `data-probara-blur`, the privacy markers of other session replay tools, `probara:blur` meta tags
  and the `blur` option are blurred while recording; the site's sanitizers pass to the capture
  engine. It ships as an ES module and as a script-tag build that sets the global `ProbaraVis`. It
  sends to `https://app.probara.net` unless `apiOrigin` names another API, which accepts pages on
  the organization's verified recording domains; a page on another domain is told so.

### Patch Changes

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`cd981b6`](https://github.com/cynch-me/probara-sdk/commit/cd981b6ab9f3be7d38a7c4475a2a976f6f594490) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Custom metadata keeps the server's depth limit too: `normalizeMetadata` refuses metadata nested
  more than `MAX_METADATA_DEPTH` (32) levels deep, the root object being level 1 and every object or
  array inside another adding one, as Probara counts it. The depth is checked with an explicit stack
  before anything serializes the value, so metadata nested thousands of levels deep is refused
  without overflowing the stack of the page. The walk follows what JSON sends, so a property JSON
  leaves out does not count and a top-level `__proto__` key, which Probara drops, is left out. The handshake answers `null` for such metadata, a reader
  ignores it, and a `metadata()` provider of `@probara/vis` that returns it is skipped.
- Updated dependencies [[`b2fc7ff`](https://github.com/cynch-me/probara-sdk/commit/b2fc7ff150dbe217043bee98363930b48c5225ff), [`04b4718`](https://github.com/cynch-me/probara-sdk/commit/04b4718c80e2d87ff7417148792e96ad0eb76e39), [`cd981b6`](https://github.com/cynch-me/probara-sdk/commit/cd981b6ab9f3be7d38a7c4475a2a976f6f594490)]:
  - @probara/vis-capture@0.1.0
