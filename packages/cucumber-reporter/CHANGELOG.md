# Changelog

All notable changes to `@probara/cucumber-reporter` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-02

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

## [0.1.0] - 2026-11-02

The first version of the formatter: a cucumber-js formatter that sends every scenario and step of a
run to Probara at the end of the run, keyed like `probara sync gherkin` keys the scenarios of the same files.

### Added

- `--format @probara/cucumber-reporter`: every attempt of every scenario is a result, with its steps,
  their keywords, Doc Strings and Data Tables, their statuses, errors and durations. Outline rows are
  results of their own with their Examples values as parameters.
- Case links: a scenario tagged `@probara:<ID>` reports to that case.
- Attachments of `this.attach` and `this.log` are uploaded to their step, or to the result for a hook.
- The options of `@probara/core` under `formatOptions.probara`, each with its `PROBARA_*` variable.
