---
'@probara/vitest-reporter': minor
---

Probara Snap in browser mode: `probaraSnap(name, options?)` takes a screenshot for visual
comparison through the browser provider. It waits for the fonts, stops animations, hides the caret
and applies the masking (`mask`, `hide`, `remove`, and the `data-probara-snap-mask` and
`data-probara-snap-hide` attributes) before the capture. The reporter uploads the screenshots at the
end of the run as one build of the commit; a merge of blob reports uploads those of every shard, and
shards that report themselves join one build: set `snap: true` (`PROBARA_SNAP`) in every shard, so a
shard without screenshots completes the build too. Two options name the build and the nonce its
shards share: `snapBuildName` (`PROBARA_SNAP_BUILD_NAME`) and `snapNonce` (`PROBARA_SNAP_NONCE`).
