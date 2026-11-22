---
'@probara/cli': minor
---

`probara snap finalize` completes the Probara Snap build the machines of a Cypress run sent with
`snap: true`, which join it without a total. A `--shard` run of Playwright or Vitest needs none. It names the build by the project, the build
name (`--build-name`, `PROBARA_SNAP_BUILD_NAME`) and the nonce (`--nonce`, `PROBARA_SNAP_NONCE`,
else what the CI gives), as the Cypress reporter does. Exit codes: 0 finalized, 1 when Probara refused or
could not be reached, 2 on a usage error.
