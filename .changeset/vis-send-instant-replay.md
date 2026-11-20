---
'@probara/vis': minor
---

The reporter sends the instant replay without its panel: `reporter.sendInstantReplay({ description })`
sends what happened up to the call in the background, with the description as its **What
happened?**, and resolves how it ended (`sent` with the Vis's `visUlid` and `url`, `no-replay`,
`busy`, `unavailable`, `failed` or `cancelled`); it never rejects. After a screen recording, it
also sends what happened before that recording. The new `onReport` option is called for every report
Probara receives, screen recordings sent from the panel included. The panel is unchanged.
