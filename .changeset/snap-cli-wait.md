---
'@probara/core': minor
'@probara/cli': minor
---

`probara snap wait` waits until Probara has compared a Snap build, for a CI without the GitHub
status Probara posts. It finds the build by `--build <ulid>`, else by the build name and the nonce
(`--build-name`, `--nonce`, their `PROBARA_SNAP_*` variables, else what the CI gives), else by the
commit the CI builds, and reads it every 5 seconds until it is complete, ends with an error or
expires, or `--max-wait` seconds pass (15 minutes by default). Exit codes: 0 complete, 1 when the
build ended with an error or expired, the wait timed out or Probara refused, 2 on a usage error,
and 4 with `--fail-on-changes` when the build has changes its review did not accept (a reference build
needs no review: only a rejected one exits 4). `--json`
prints the build.

In core, `waitForSnapBuild(options)` is that wait, with `sleep` and `now` as its clock, and the
client gains `listSnapBuilds` (newest first, by name, branch, commit, nonce or run).
