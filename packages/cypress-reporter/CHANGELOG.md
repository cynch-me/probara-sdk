# Changelog

All notable changes to `@probara/cypress-reporter` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
