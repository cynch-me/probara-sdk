# Changelog

All notable changes to `@probara/playwright-reporter` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in
[upgrading](docs/upgrade.md).

## [Unreleased]

The first version of the reporter, to be published on npm as 0.1.0.

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
  together; the files of the output folder keep their absolute paths.
- The reporter never throws into Playwright and never changes its exit code; reporting problems
  are logged on stderr, never with the token.
- `assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO`) asks every report to assign each run case it
  leaves failed and without an assignee to one of up to 20 members, in turn
  ([configuration](docs/configuration.md#options)).
