---
'@probara/core': minor
---

Probara Snap: `uploadSnapScreenshots(options)` sends the screenshots of one job as a shard of a
Snap build. It creates the build of the commit (or joins the one the other jobs of the CI run
created), uploads the PNGs Probara does not hold yet, finalizes the shard, and logs the build's
page. `detectSnapCiSource(env)` adds what a build needs to `detectCiSource`: the head commit of
a GitHub pull request, the base branch and the nonce of the CI run. The client gains
`createSnapBuild`, `uploadSnapFile`, `finalizeSnapShard`, `finalizeSnapBuild` and
`getSnapBuild`; `sha256Of` and `resolveTextSetting` are exported too.
