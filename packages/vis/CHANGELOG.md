# @probara/vis

## 0.5.0

### Minor Changes

- [#29](https://github.com/cynch-me/probara-sdk/pull/29) [`1972701`](https://github.com/cynch-me/probara-sdk/commit/197270143e01e7768bcc965a9bbb9ca8c664b267) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - The reporter sends the instant replay without its panel: `reporter.sendInstantReplay({ description })`
  sends what happened up to the call in the background, with the description as its **What
  happened?**, and resolves how it ended (`sent` with the Vis's `visUlid` and `url`, `no-replay`,
  `busy`, `unavailable`, `failed` or `cancelled`); it never rejects. After a screen recording, it
  also sends what happened before that recording. The new `onReport` option is called for every report
  Probara receives, screen recordings sent from the panel included. The panel is unchanged.

## 0.4.1

### Patch Changes

- [#27](https://github.com/cynch-me/probara-sdk/pull/27) [`d434013`](https://github.com/cynch-me/probara-sdk/commit/d434013ee55b307a3ea3f2f2a09704f69a008d08) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - The instant replay keeps buffering when the review of **Send what just happened** is closed: the
  next time the panel opens, the review shows what happened up to then, with the current time, as
  the first one did. In 0.4.0 the panel's **Close** froze the instant replay and showed the same one
  again, however long the page was used meanwhile. What was typed in **What happened?** is no longer
  kept once the review is closed. `reporter.close()` in the review now does the same as **Close**.

## 0.4.0

### Minor Changes

- [#25](https://github.com/cynch-me/probara-sdk/pull/25) [`31017ef`](https://github.com/cynch-me/probara-sdk/commit/31017ef8d3303050ae1a04666d6db080ce0df18d) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Redesign the Vis panel and launcher in the look of Probara's recording page: the Probara mark and
  link at the top, a Microphone switch, whether it is recording or paused with the time against the
  limit and a progress bar, an icon beside each message, and the confirmations in place of the
  review. The panel and the launcher follow the page's `color-scheme` (dark on a dark page); the
  launcher's default colours are now the panel's card colours; `--probara-vis-accent` and
  `--probara-vis-accent-contrast` still override them, and are set together (the text no longer
  defaults to white). The review of an instant replay no longer shows counts of console errors and
  failed requests, which still reach Probara, nor a hint under **What happened?**; its **Close**
  keeps the instant replay and what was typed for the next time the panel opens. The recording link's messages now carry a
  title and what to do next.

## 0.3.0

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

### Patch Changes

- Updated dependencies [[`f7c0004`](https://github.com/cynch-me/probara-sdk/commit/f7c00042ae7ccbd4d0177435f4cd74f2aac12439)]:
  - @probara/vis-capture@0.2.0

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
