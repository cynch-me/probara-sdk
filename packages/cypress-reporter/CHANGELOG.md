# Changelog

All notable changes to `@probara/cypress-reporter` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The `probara.*` helpers of the browser read `Cypress.expose('probara')` again while it is still
  absent, instead of deciding that a run has no plugin of this package when the support file loads.
  Cypress sends the browser what `config.expose` held when `setupNodeEvents` returned, so a support
  file that loaded before that point used to leave every helper a silent no-op for the whole run,
  whatever platform the timing differed on.
- The warning a spec with no plugin logs on the browser console says what was missing and both of
  its causes (a config that registers no plugin, a Cypress that does not expose `config.expose`),
  and it waits for the first hook of the spec, so a plugin that writes its settings late is no
  longer accused of not being there.

## [0.1.0] - 2026-10-05

The first version of the reporter.

### Added

- A Cypress reporter, `reporter: '@probara/cypress-reporter'` in `cypress.config`, that sends every
  test result of a run to one Probara run, closed at the end, configured by `reporterOptions` and
  the `PROBARA_*` variables, options first. Requires Node.js 22.12 and Cypress 12.17.4 or later;
  the package is CommonJS, as Cypress loads reporters with `require`.
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
- One reading of the reporter options for both processes, so `reporterOptions` wrapped the way a
  multi-reporter wraps it (`{ '@probara/cypress-reporter': { … } }`) configures the reporter and the
  plugin alike.
