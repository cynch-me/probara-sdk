# @probara/core

## 0.9.0

### Minor Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`f13d525`](https://github.com/cynch-me/probara-sdk/commit/f13d52564e47799ef8de85137c31631d092eaad4) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - `probara snap wait` waits until Probara has compared a Snap build, for a CI without the GitHub
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

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`6296481`](https://github.com/cynch-me/probara-sdk/commit/6296481296f31fb9504ae9ed6670e89a709cca63) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: `uploadSnapScreenshots(options)` sends the screenshots of one job as a shard of a
  Snap build. It creates the build of the commit (or joins the one the other jobs of the CI run
  created), uploads the PNGs Probara does not hold yet, finalizes the shard, and logs the build's
  page. `detectSnapCiSource(env)` adds what a build needs to `detectCiSource`: the head commit of
  a GitHub pull request, the base branch and the nonce of the CI run. The client gains
  `createSnapBuild`, `uploadSnapFile`, `finalizeSnapShard`, `finalizeSnapBuild` and
  `getSnapBuild`; `sha256Of` and `resolveTextSetting` are exported too.

  A run split across machines without a known total joins its build with `parallel: true`, by the
  nonce alone, and `finalizeSnapBuildByNonce(options)` (the client's `finalizeSnapBuildByNonce`)
  completes it. `resolveSnapSettings` and `snapNonceOf` resolve the `snap`, `snapBuildName` and
  `snapNonce` options of an adapter, and `snapsOf` with the `SNAP_*` constants, `checkSnapName`,
  `checkSnapThreshold`, `duplicateSnapName` and `snapStabilizingCss` (also in
  `@probara/core/browser`) are what an adapter's `probaraSnap` and its reporter share.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`02b9bd5`](https://github.com/cynch-me/probara-sdk/commit/02b9bd5270d2ebfc7a74ea2399cf21f02d58b121) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap reads a GitHub Actions merge queue run (`merge_group`): the build keeps its queue branch
  (`gh-readonly-queue/<base>/pr-<n>-<sha>`), and sends `<base>` as its base branch and `<n>` as its
  pull request, so Probara compares it with its base branch like a pull request build.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`64e6092`](https://github.com/cynch-me/probara-sdk/commit/64e6092c3775ef9a7f1f89bf5ecaf14560c0fa77) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: a build sends the commits Probara picks its baseline among (`parentCommits`): the
  merge base of the commit and the base branch of its pull request, then its ancestors, at most 300,
  or the commit and its ancestors on a push. They are read from the git checkout, and a shallow clone
  is deepened from `origin`, so the CI needs no `fetch-depth: 0`. Without git or its history the
  build is still sent, without them. `uploadSnapScreenshots` takes the checkout as `cwd`.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`27f8e30`](https://github.com/cynch-me/probara-sdk/commit/27f8e309179deabacf7609beaa4db091f25aae9e) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: every screenshot carries the metadata Probara shows beside it. `uploadSnapScreenshots`
  sends the package that uploads (`sdk`, `@probara/core` unless the caller names its own), and a
  screenshot may carry its browser version, the URL of its page (only an `http` or `https` URL), the
  automation library and its version, and where its test is declared, its retries, annotations and
  tags. Values the Snap API would refuse are left out, and the screenshot is still sent. The
  Playwright reporter sends `@playwright/test` and its version, the browser version, the page's URL,
  the test's line and column, its `retries`, annotations and tags; the Cypress reporter sends Cypress
  and its version, the browser version, the page's URL and the test's `retries`; the Vitest reporter
  sends Vitest and its version, the page's URL, the test's `retries`, annotations, tags and location;
  `probara snap upload` names `@probara/cli`.

### Patch Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`b3bc1b3`](https://github.com/cynch-me/probara-sdk/commit/b3bc1b33c048d46542baee40cd603be2e0501e95) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Follow the published API again. `listRunCaseKeys` reads the parameters of a case as the server
  lists them, by name and value, and still answers them as a record (`{ browser: 'chromium' }`):
  they were dropped before. The CLI docs no longer list the `case_archived` reason: a result that
  matches an archived case restores the case and is recorded.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`0e1cf3f`](https://github.com/cynch-me/probara-sdk/commit/0e1cf3feaad58597722f35cce00b64903a6a9ea4) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - The Snap API types include build review status, comparison counts, the linked run and each screenshot's test case, and the build link names the project and the build.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`a450722`](https://github.com/cynch-me/probara-sdk/commit/a4507220f633f67a9d14f4b9f44a4562dfed3fa8) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: `listSnapBuilds` lists builds a page at a time and answers
  `{ items, page, pageSize, total }`. It takes `page` and `pageSize` in place of `limit` and
  `cursor`, and searches and filters with `q`, `type`, `status` and `review`. Waiting for a
  build reads the newest match with `pageSize: 1`.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`7a8647b`](https://github.com/cynch-me/probara-sdk/commit/7a8647b0c1979a9856912f1f08935a36486c9900) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: each screenshot carries `test.captureIndex`, its position among the screenshots its
  test took in the attempt that was sent, from 0. The build page orders the journey of a test by it.

## 0.8.0

### Minor Changes

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`f59373a`](https://github.com/cynch-me/probara-sdk/commit/f59373afc9f54d1aea9398ca95d95bbab10414a0) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New `probara vis` commands: `list`, `get`, `create`, `update` and `delete`. `vis create <file>`
  uploads a video (MP4 or WebM, in 8 MiB parts) or an image (PNG, JPEG or WebP) as a Vis, and
  `--playwright-trace <trace.zip>` attaches the console, the network and the user actions of a
  Playwright trace, with secrets redacted before anything is sent. The core client gains the Vis
  endpoints these commands call. The Vis commands need a personal API token.

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`06c987a`](https://github.com/cynch-me/probara-sdk/commit/06c987af3f5379595fb841a5ed5903ddf1153061) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - `probara vis record` reads the plan's longest recording from Probara before the recording starts
  and stops there, saying so with the plan's limit; `--duration` cannot go past it, and a plan
  without a limit records until it is stopped. When the limit cannot be read, the recording keeps
  its 60 minutes as before; the command waits at most 3 seconds for it, and Ctrl+C while it waits
  ends the command before anything is recorded or created. The core client reads the organization's Vis settings with the plan's
  limits: `getVisSettings()` (`GET /api/v1/vis-settings`), with the `VisSettings` and
  `VisPlanLimits` types and `VIS_UNLIMITED`.

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`2c62754`](https://github.com/cynch-me/probara-sdk/commit/2c627546e9dd8f391c6e7686893992c7d56c2c0b) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New `probara vis recording-links list|get|create|update|revoke|delete`: manages the recording links
  of the organization, URLs anyone records their screen with, no account needed, whose recordings
  arrive as Vises. `create` takes the title, folder and reference of the Vises the link receives,
  `--one-time`, `--expires` and `--[no-]microphone`, and prints the ULID and the URL of the link;
  `revoke` and `delete` ask for a confirmation unless `--yes` is given. The core client gains the
  recording link endpoints these commands call (`listVisRecordingLinks`, `getVisRecordingLink`,
  `createVisRecordingLink`, `updateVisRecordingLink`, `revokeVisRecordingLink`,
  `deleteVisRecordingLink`) and their types.

## 0.7.1

### Patch Changes

- [#16](https://github.com/cynch-me/probara-sdk/pull/16) [`462fc2c`](https://github.com/cynch-me/probara-sdk/commit/462fc2c8a3a8b758475f1fae608dc924ec5ad779) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Published from GitHub Actions with npm provenance, so npm shows the commit and workflow that built each version.

## 0.7.0

### Changed

- **Breaking, needs an action:** the automation key of a test no longer carries its parameters
  (`logs in [browser=chromium]` is now `logs in`). The parameters are sent with each result instead.
  A case reported with an earlier key is not matched by this version
  ([upgrading](../cli/docs/upgrade.md#070-the-parameters-are-not-part-of-the-key)).
- A result is sent with its `identity.parameters` (such as a Playwright project) as well as its own
  parameters; on a shared name the identity's value wins.

### Added

- `listRunCaseKeys` returns the `parameters` of each case when the server sends them.
- A report entry lists the names of its parameters that are reporter context in `contextParameters`: the
  identity's parameters (the framework's own, such as a Playwright project) are shown on the result and
  never become parameters of a case a report creates. It needs a server that accepts `contextParameters`,
  released together with the parameterized test cases server change.
