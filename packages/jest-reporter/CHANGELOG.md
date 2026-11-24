# @probara/jest-reporter

## 0.3.3

### Patch Changes

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

- Docs: the rows of `test.each` are told apart by their titles. To keep the rows of one test as one
  case, give them one title and declare each row's values with `probara.parameters()`.

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

- A Jest reporter, `reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]]` in
  a CommonJS or ES module Jest config, that sends every test result of a run to one Probara run,
  closed at the end, configured by its options and `PROBARA_*` variables, options first
  ([configuration](docs/configuration.md)). Requires Node.js 22.12 and Jest 29.6 or later; the
  package is CommonJS, as Jest loads reporters and test-side modules with `require`.
- The automation keys `probara import junit` gives jest-junit's report written with
  `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`, so a project can switch from the JUnit import without
  losing a case; `keyIncludesFile: false` (`PROBARA_KEY_INCLUDES_FILE`) gives the keys of reports
  without the file attribute ([same cases as the JUnit import](README.md#same-cases-as-the-junit-import)).
  Names follow jest-junit's default templates to the letter: `test.each` rows, `$` patterns of a
  title, `{displayName}` filled with the Jest project's name
  ([migrating from the JUnit import](docs/migrating-from-junit.md)).
- One result per attempt, `jest.retryTimes` retries included, with Jest's verdict: `test.failing`
  honored, `test.skip` and skipped describes as skipped, `test.todo` as skipped with the note
  `Todo`, errors in the notes without terminal colors, the start time and duration of each
  attempt. A test file whose `afterAll` hook throws gets the extra failed result jest-junit writes;
  a test file Jest cannot run is named in one warning.
- Linking by case ids in titles and describes (`SHOP-12 adds an item`) and `probara.id()`; a test
  linked to several cases is sent once per case ([linking](docs/linking.md)).
- `probara.*` helpers, imported from `@probara/jest-reporter`, that work in every Jest worker, in
  band, and in `node` and `jsdom` environments: `id`, `title`, `suite`, `comment`, `ignore`,
  `tags`, `fields`, `parameters`, `attach` (a file or a body, copied when called; a body without
  a `contentType` typed from its name's extension), `step(title, body?, { expected, data })`
  (nested, with status, duration, error and the files attached inside), `link(url, name?)` and
  `issue(id)`, `test.concurrent` tests and watch mode included ([metadata](docs/metadata.md),
  [steps](docs/steps.md), [attachments](docs/attachments.md), [links](docs/links.md)). A call
  outside a running test, or one Probara cannot use, is left out with a warning; nothing throws
  into a test. What the helpers said about two tests of one file with the same full name, or
  about a file two Jest projects run at the same moment, is left out with a warning rather than
  given to the wrong test.
- `issueUrlTemplate` (`PROBARA_ISSUE_URL_TEMPLATE`): the URL each `probara.issue(id)` becomes.
- The setup file `@probara/jest-reporter/setup` (`setupFilesAfterEnv`), for `captureOutput`
  (`PROBARA_CAPTURE_OUTPUT`), each attempt's console output as `stdout.log` and `stderr.log`, and
  `runCasesOnly` (`PROBARA_RUN_CASES_ONLY`), which runs only the tests of the cases of the run
  `PROBARA_RUN_ULID` names and reports into it, with Jest's hooks from `@jest/globals` when globals
  are not injected; when it cannot select, every test runs and is reported, with a warning
  ([run selection](docs/run-selection.md)).
- `assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO`) asks every report to assign each run case it
  leaves failed and without an assignee to one of the listed members, in turn
  ([assign failed results](docs/assign-failed.md)).
- Runs by name: environment, milestone, test plan, configurations, description and tags, and the
  CI source; one run for every shard of a sharded job with `probara run create` and
  `PROBARA_RUN_ULID` ([sharding](docs/ci/sharding.md)); several Probara projects with `projects`
  and `run.ulids`, and Jest `projects`, which add nothing to the keys
  ([Jest and Probara projects](docs/projects.md)); one run per `--watch` session, never closed by
  the reporter: a re-run its run refuses (closed or deleted in Probara) goes into a new run at once,
  or stays in the results file ([watch mode](docs/watch.md)).
- A results file (`resultsFile`) for what could not be sent, or every result with reporting off,
  with the attached files next to it in `<name>-attachments/`, sent later by
  `probara import results 'probara-results*.json'` ([results file](docs/results-file.md)). A
  results file is trusted input: its attachments are uploaded from the paths it names, so import
  only the files your own jobs wrote. The import leaves out, with a warning, an attachment whose
  relative path leads outside the folder of the file; absolute paths are kept.
- The reporter never throws into Jest and never changes its exit code; reporting problems are
  logged on stderr, never with the token ([troubleshooting](docs/troubleshooting.md)).
- Documentation for every feature, each example run against the real reporter in a real Jest by the
  docs tests: CI guides for GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure Pipelines,
  Bitbucket Pipelines and Buildkite, and migration guides from the JUnit import, Qase, Test IT,
  ReportPortal, Allure and TestRail, with what is not ported and why.
