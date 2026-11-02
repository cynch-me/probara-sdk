# Changelog

All notable changes to `@probara/cucumber-reporter` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-01

The first version of the formatter: a cucumber-js formatter that sends every scenario and step of a
run to Probara at the end of the run, keyed like `probara sync gherkin` keys the scenarios of the same files.

### Added

- `--format @probara/cucumber-reporter`: every attempt of every scenario is a result, with its steps,
  their keywords, Doc Strings and Data Tables, their statuses, errors and durations. Outline rows are
  results of their own with their Examples values as parameters.
- Case links: a scenario tagged `@probara:<ID>` reports to that case.
- Attachments of `this.attach` and `this.log` are uploaded to their step, or to the result for a hook.
- The options of `@probara/core` under `formatOptions.probara`, each with its `PROBARA_*` variable.
