# @probara/playwright-reporter

## 0.4.0

### Minor Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`6296481`](https://github.com/cynch-me/probara-sdk/commit/6296481296f31fb9504ae9ed6670e89a709cca63) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: `probaraSnap(page, name, options?)` takes a screenshot for visual comparison. It
  waits for the fonts, stops animations, hides the caret and applies the masking (`mask`, `hide`,
  `remove`, and the `data-probara-snap-mask` and `data-probara-snap-hide` attributes) before the
  capture. The reporter uploads the screenshots at the end of the run as one build of the commit,
  and the shards of a CI run join one build: set `snap: true` (`PROBARA_SNAP`) in every shard, so
  a shard without screenshots completes the build too. Two options name the build and the nonce its shards
  share: `snapBuildName` (`PROBARA_SNAP_BUILD_NAME`) and `snapNonce` (`PROBARA_SNAP_NONCE`).

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

### Changed

- **Breaking, needs an action:** a test's automation key no longer ends with its Playwright project
  (`[project=chromium]`). The projects of a test share one key and one case, and the project is sent
  as the `project` parameter of each result. A test reported before this version is not matched by the
  next run, which creates a new case
  ([upgrading](docs/upgrade.md#030-the-parameters-are-not-part-of-the-key)).

### Added

- The `project` of each result is sent as a context parameter, listed in `contextParameters`: shown on the
  result, never a parameter of a case a report creates. It needs a server that accepts `contextParameters`,
  released together with the parameterized test cases server change.

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

The first version of the reporter, and the first one published on npm.

### Added

- A Playwright reporter, `['@probara/playwright-reporter']` in `playwright.config`, that sends
  every attempt of a run to one Probara run, closed at the end, configured by its options and
  `PROBARA_*` variables, options first ([configuration](docs/configuration.md)). Requires Node.js
  22.12 and `@playwright/test` 1.42 or later.
- Linking by `probara_case` annotations, case ids in titles and `probara.id()`, every source
  together; a test linked to several cases is sent once per case. The automation keys equal those
  `probara import junit` gives Playwright's JUnit reporter, so a project can switch without losing
  a case ([linking](docs/linking.md)).
- Statuses with Playwright's verdict: `test.fail()` honored, timeouts and interruptions failed,
  skip reasons in the notes; `statusMapping` and `statusFilter` ([statuses](docs/statuses.md)).
  Every retry is a result of its own ([retries](docs/retries.md)).
- Steps from `test.step` and the hooks that run steps, nested, with status, duration, error and
  the files attached inside them (Playwright 1.50 and later) ([steps](docs/steps.md)).
- Attachments: screenshots, videos, traces, error context, `testInfo.attach()` bodies and files,
  named after the attachment when Playwright hashed the file name; `captureOutput` attaches stdout
  and stderr ([attachments](docs/attachments.md)).
- `probara.*` helpers for tests, hooks and fixtures: `id`, `title`, `suite`, `comment`, `ignore`,
  `tags`, `fields` (system and custom fields by name), `parameters`, `attach` and
  `step(action, expected, data)`, which declares the steps of a case the report creates
  ([metadata](docs/metadata.md)).
- Runs by name: environment, milestone, test plan, configurations, description and tags; the CI
  source detected on seven CI providers ([run options](docs/runs.md)).
- One run for sharded pipelines, with `merge-reports` or `probara run create` and
  `PROBARA_RUN_ULID` ([sharding](docs/ci/sharding.md)), and guides for GitHub Actions, GitLab CI,
  CircleCI, Azure Pipelines, Jenkins, Bitbucket Pipelines and Buildkite.
- Several Probara projects in one suite: `projects` and `run.ulids`, each result into a run of its
  case's project ([several projects](docs/multi-project.md)).
- A results file (`resultsFile`) for what could not be sent, or every attempt with reporting off,
  sent later by `probara import results 'probara-results*.json'`. A file already there is never
  touched: the reporter writes to its first free sibling (`probara-results-2.json`, ...), and every
  write is atomic ([results file](docs/results-file.md)). The bodies stored next to the file, in
  `<name>-attachments/`, are referenced relative to it, so the file and that folder can move
  together; the files of the output folder keep their absolute paths. A results file is trusted
  input: its attachments are uploaded from the paths it names, so import only the files your own
  jobs wrote. The import leaves out, with a warning, an attachment whose relative path leads
  outside the folder of the file; absolute paths are kept.
- The reporter never throws into Playwright and never changes its exit code; reporting problems
  are logged on stderr, never with the token.
- `assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO`) asks every report to assign each run case it
  leaves failed and without an assignee to one of up to 20 members, in turn
  ([configuration](docs/configuration.md#options)).
