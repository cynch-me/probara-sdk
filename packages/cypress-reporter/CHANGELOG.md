# @probara/cypress-reporter

## 0.4.0

### Minor Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`30ee918`](https://github.com/cynch-me/probara-sdk/commit/30ee91858ae23ea71991d4fc584441c06c90bbc6) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: `cy.probaraSnap(name, options?)`, added by the support file, takes a screenshot for
  visual comparison. It waits for the fonts, stops animations, hides the caret and applies the masking
  (`mask`, `hide`, `remove`, and the `data-probara-snap-mask` and `data-probara-snap-hide`
  attributes) before Cypress captures the page. The plugin uploads the screenshots at the end of
  `cypress run` as one build of the commit, named with `snapBuildName` (`PROBARA_SNAP_BUILD_NAME`).
  When the specs are split across machines (`--parallel`, or `--spec` per machine), `snap: true`
  (`PROBARA_SNAP`) on every machine makes them join one build by the nonce they share (`snapNonce`,
  `PROBARA_SNAP_NONCE`, else what the CI gives), and `probara snap finalize` of `@probara/cli`
  completes it in a final job.

### Patch Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`7a8647b`](https://github.com/cynch-me/probara-sdk/commit/7a8647b0c1979a9856912f1f08935a36486c9900) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: each screenshot carries `test.captureIndex`, its position among the screenshots its
  test took in the attempt that was sent, from 0. The build page orders the journey of a test by it.

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
- Updated dependencies [[`b3bc1b3`](https://github.com/cynch-me/probara-sdk/commit/b3bc1b33c048d46542baee40cd603be2e0501e95), [`0e1cf3f`](https://github.com/cynch-me/probara-sdk/commit/0e1cf3feaad58597722f35cce00b64903a6a9ea4), [`a450722`](https://github.com/cynch-me/probara-sdk/commit/a4507220f633f67a9d14f4b9f44a4562dfed3fa8), [`7a8647b`](https://github.com/cynch-me/probara-sdk/commit/7a8647b0c1979a9856912f1f08935a36486c9900), [`f13d525`](https://github.com/cynch-me/probara-sdk/commit/f13d52564e47799ef8de85137c31631d092eaad4), [`6296481`](https://github.com/cynch-me/probara-sdk/commit/6296481296f31fb9504ae9ed6670e89a709cca63), [`02b9bd5`](https://github.com/cynch-me/probara-sdk/commit/02b9bd5270d2ebfc7a74ea2399cf21f02d58b121), [`64e6092`](https://github.com/cynch-me/probara-sdk/commit/64e6092c3775ef9a7f1f89bf5ecaf14560c0fa77), [`27f8e30`](https://github.com/cynch-me/probara-sdk/commit/27f8e309179deabacf7609beaa4db091f25aae9e)]:
  - @probara/core@0.9.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`f59373a`](https://github.com/cynch-me/probara-sdk/commit/f59373afc9f54d1aea9398ca95d95bbab10414a0), [`06c987a`](https://github.com/cynch-me/probara-sdk/commit/06c987af3f5379595fb841a5ed5903ddf1153061), [`2c62754`](https://github.com/cynch-me/probara-sdk/commit/2c627546e9dd8f391c6e7686893992c7d56c2c0b)]:
  - @probara/core@0.8.0

## 0.3.1

### Patch Changes

- [#16](https://github.com/cynch-me/probara-sdk/pull/16) [`462fc2c`](https://github.com/cynch-me/probara-sdk/commit/462fc2c8a3a8b758475f1fae608dc924ec5ad779) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Published from GitHub Actions with npm provenance, so npm shows the commit and workflow that built each version.
- Updated dependencies [[`462fc2c`](https://github.com/cynch-me/probara-sdk/commit/462fc2c8a3a8b758475f1fae608dc924ec5ad779)]:
  - @probara/core@0.7.1

## 0.3.0

### Added

- The browser and the attempt of an execution are sent as context parameters, listed in
  `contextParameters`: shown on the result, never a parameter of a case a report creates. It needs a server
  that accepts `contextParameters`, released together with the parameterized test cases server change.

## 0.2.0

### Added

- In GitHub Actions the run's source names the workflow run (`provider`, `repository`, `ciRunId`,
  `ciRunAttempt`) along with the commit author, pull request, workflow and job, so every job of one
  workflow run that reports without `run.ulid` goes into one run
  ([GitHub Actions](docs/ci/github-actions.md#parallel-jobs-one-run-closed-by-the-final-job)). The
  new `source` fields override them one by one.
- A job that reports after the run of its workflow run was closed (409 `ci_run_closed`) stops
  sending and logs why.
- Parallel GitHub Actions jobs share the run of their workflow run by leaving it open with
  `closeRun: false` (or `PROBARA_CLOSE_RUN=false`) and closing it from a final job with
  `probara run close`; `closeRun` keeps its default, so a single job still closes its run.

### Changed

- With `provider: github_actions`, a source commit that is not a 7 to 40 character hex SHA is left
  out with a warning.

## 0.1.0

The first version of the reporter.

### Added

- A Cypress reporter, `reporter: '@probara/cypress-reporter'` in `cypress.config`, that sends every
  test result of a run to one Probara run, closed at the end, configured by `reporterOptions` and
  the `PROBARA_*` variables, options first. Requires Node.js 22.12 and Cypress 15.10.0 or later
  (the `probara.*` helpers read the plugin's settings with `Cypress.expose()`); the package is
  CommonJS, as Cypress loads reporters with `require`.
- Every `[probara]` line of the reporter and its plugin on stdout: the `cypress` command relays
  the stderr of a run through an asynchronous filter and exits without draining it, which could
  drop the last lines of a run.
- The automation keys `probara import junit` gives cypress-junit's output: the spec file with
  `keyIncludesFile`, and the full title (the describes and the `it` title joined by spaces) as a
  single title segment.
- One result per attempt, Cypress retries included: `pass` as passed, `fail` as failed, `it.skip`
  as skipped, the failed attempt a `retry` event stands for, and every test a failing hook kept
  from running as skipped.
- `setupNodeEvents`, from `@probara/cypress-reporter/setup`, which registers the `probara` task,
  forwards `before:spec`, `after:spec`, `after:screenshot` and `after:run`, and completes and
  closes the run.
- The screenshot of every failed attempt, attached to the result of that exact attempt
  (`attachScreenshots`, on by default: Cypress names the screenshot after the test it took it for),
  and the video of a spec on every failed result of it (`attachVideos`, off by default, needs
  `video: true`).
- The browser Cypress runs as a `browser` parameter of every result (`browserAsParameter`, on by
  default), never part of the key.
- `@probara/cypress-reporter/support`, one line in the Cypress support file, which publishes the
  `probara.*` helpers of the browser (`id`, `title`, `suite`, `comment`, `ignore`, `parameters`,
  `tags`, `fields`, `link`, `issue`, `attach`, `step`, nested, with expected results and data),
  reaches the spec through the global `probara`, and never throws into a test: a wrong argument, a
  helper in a hook that runs no test, or a run with no plugin is a warning and nothing more.
- `captureOutput`, which attaches what each test writes to the browser console as `stdout.log` and
  `stderr.log`, cut at 32 MiB.
- `runCasesOnly` with `PROBARA_RUN_ULID`: run only the tests of the cases of a run, matched by
  automation key or by a case id in a title or a `describe`, and leave the rest out of the report.
  Every test runs and is reported when the run's cases cannot be read, with one warning.
- `issueUrlTemplate`, which turns each `probara.issue(id)` into a named link of the result.
- `assignFailedTo`, which assigns every run case the report leaves failed to one of the listed
  members, round-robin, and never overwrites an assignee.
- One reading of the reporter options for both processes, so a `cypress-multi-reporters`
  configuration (this reporter's options under `probaraCypressReporterReporterOptions`) configures
  the reporter and the plugin alike.
