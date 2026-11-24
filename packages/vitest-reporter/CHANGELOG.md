# @probara/vitest-reporter

## 0.4.0

### Minor Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`7c672fa`](https://github.com/cynch-me/probara-sdk/commit/7c672fa38d0bdf75429ce619ca048f5d0cc1ce88) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap in browser mode: `probaraSnap(name, options?)` takes a screenshot for visual
  comparison through the browser provider. It waits for the fonts, stops animations, hides the caret
  and applies the masking (`mask`, `hide`, `remove`, and the `data-probara-snap-mask` and
  `data-probara-snap-hide` attributes) before the capture. The reporter uploads the screenshots at the
  end of the run as one build of the commit; a merge of blob reports uploads those of every shard, and
  shards that report themselves join one build: set `snap: true` (`PROBARA_SNAP`) in every shard, so a
  shard without screenshots completes the build too. Two options name the build and the nonce its
  shards share: `snapBuildName` (`PROBARA_SNAP_BUILD_NAME`) and `snapNonce` (`PROBARA_SNAP_NONCE`).

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

- Docs: the rows of `test.each` and `test.for` are told apart by their titles. To keep the rows of one
  test as one case, give them one title and declare each row's values with `probara.parameters()`.

### Added

- The project, the attempt and the repeat of an execution are sent as context parameters, listed in
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

- A Vitest reporter, `['@probara/vitest-reporter', { projectId: 'SHOP' }]` after `default` in the
  reporters of the Vitest config, that sends every test result of a run to one Probara run, closed
  at the end, configured by its options and `PROBARA_*` variables, options first
  ([configuration](docs/configuration.md)). Requires Node.js 22.12 and Vitest 3.2, 4 or 5; the
  package is an ES module.
- The reporter adds its setup file and its runner to every Vitest project: nothing goes in
  `setupFiles` or `runner`.
- The automation keys `probara import junit` gives Vitest's JUnit output, on Vitest 3, 4 and 5, so
  a project can switch from the JUnit import without losing a case; `keyIncludesFile: false`
  (`PROBARA_KEY_INCLUDES_FILE`) leaves the file out
  ([same cases as the JUnit import](README.md#same-cases-as-the-junit-import)).
- One result per attempt of `retry` and per execution of `repeats`, with Vitest's verdict:
  `test.fails` honored, skipped tests, `todo` with the note `Todo`, `context.skip(note)` with the
  note `Skipped: <note>`, every error of an attempt in its notes (`expect.soft` included), and a
  failed result for a `beforeAll` or `afterAll` that throws and for a file that fails to load
  ([statuses](docs/statuses.md), [retries and repeats](docs/retries.md)).
- Linking by case ids in titles and describes (`SHOP-12 adds an item`) and `probara.id()`; a test
  linked to several cases is sent once per case ([linking](docs/linking.md)).
- `probara.*` helpers, imported from `@probara/vitest-reporter`, in Node (`test.concurrent` tests
  included) and in browser mode: `id`, `title`, `suite`, `comment`, `ignore`, `tags`, `fields`,
  `parameters`, `attach` (awaited; a file or a body, copied when called),
  `step(title, body?, { expected, data })`, `link(url, name?)` and `issue(id)`
  ([metadata](docs/metadata.md), [steps](docs/steps.md), [attachments](docs/attachments.md),
  [links](docs/links.md)). A call Probara cannot use is left out with a warning; nothing throws
  into a test.
- Vitest's own files with each result: the attachments of `context.annotate()` and the failure
  screenshots of browser mode (`attachScreenshots`, `PROBARA_ATTACH_SCREENSHOTS`); with
  `captureOutput` (`PROBARA_CAPTURE_OUTPUT`), each attempt's console output as `stdout.log` and
  `stderr.log` ([captured output](docs/output.md)).
- Vitest tags (4.1 and later) join the tags of a created case, and a run of several Vitest projects
  names each result's project in its `project` parameter ([projects](docs/projects.md)).
- Runs by name, environment, milestone, test plan, configurations, description and tags, and the
  CI source ([run options](docs/runs.md)); one run per `--watch` session, never closed by the
  reporter ([watch mode](docs/watch.md)); one run for a sharded job, merged from its blob reports
  or shared with `probara run create` and `PROBARA_RUN_ULID` ([sharding](docs/ci/sharding.md));
  several Probara projects with `projects` and `run.ulids`.
- `runCasesOnly` (`PROBARA_RUN_CASES_ONLY`), which runs only the tests of the cases of a Probara
  run ([run selection](docs/run-selection.md)); `assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO`)
  ([assign failed results](docs/assign-failed.md)); `issueUrlTemplate`
  (`PROBARA_ISSUE_URL_TEMPLATE`), the URL each `probara.issue(id)` becomes.
- A results file (`resultsFile`) for what could not be sent, with the attached files next to it in
  `<name>-attachments/`, sent later by `probara import results 'probara-results*.json'`
  ([results file](docs/results-file.md)).
- The reporter never throws into Vitest and never changes its exit code; reporting problems are
  logged on stderr, never with the token ([troubleshooting](docs/troubleshooting.md)).
- Documentation for every feature, each example run against the real reporter in a real Vitest by
  the docs tests: CI guides for GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Jenkins,
  Bitbucket Pipelines and Buildkite, and guides from the JUnit import, Qase, Allure, ReportPortal
  and TestRail, with what is not supported and why.
