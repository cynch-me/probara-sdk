---
'@probara/vis-capture': minor
'@probara/vis': minor
---

One capture for every Probara SDK on a page. `attachSharedCapture()` in `@probara/vis-capture`
starts one set of console, network, WebSocket and user event interceptors and at most one DOM
replay, registered under `Symbol.for('probara.capture')`, which `@probara/vis` and
`@probara/browser` attach to, so a page running both records everything once. Reads are
non-destructive (`snapshot()`), and every attached SDK's sanitizers, ignored URLs and blur apply.
`startPageCaptures`, `applyAutoBlur`, `PRIVACY_SELECTORS` and `BLUR_META_NAME` move to
`@probara/vis-capture` (`@probara/vis` still exports the last two), and the replay recorder gains
`checkout()`, which starts a new segment from a full snapshot.
