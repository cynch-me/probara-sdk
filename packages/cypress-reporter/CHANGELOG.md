# Changelog

All notable changes to `@probara/cypress-reporter` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- In GitHub Actions the run's source names the workflow run (`provider`, `repository`, `ciRunId`,
  `ciRunAttempt`) along with the commit author, pull request, workflow and job, so every job of one
  workflow run that reports without `run.ulid` goes into one run
  ([GitHub Actions](docs/ci/github-actions.md#parallel-jobs-one-run-closed-by-the-final-job)). The
  new `source` fields override them one by one.
- `run.id` (`PROBARA_RUN_ID`): the run Probara launched the workflow for, reported into like
  `run.ulid` ([a run launched from Probara](docs/ci/github-actions.md#a-run-launched-from-probara)).
- A job that reports after the run of its workflow run was closed (409 `ci_run_closed`) stops
  sending and logs why.
- Parallel GitHub Actions jobs share the run of their workflow run by leaving it open with
  `closeRun: false` (or `PROBARA_CLOSE_RUN=false`) and closing it from a final job with
  `probara run close`; `closeRun` keeps its default, so a single job still closes its run.

### Changed

- With `provider: github_actions`, a source commit that is not a 7 to 40 character hex SHA is left
  out with a warning.

## [0.1.0] - 2026-10-05

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
