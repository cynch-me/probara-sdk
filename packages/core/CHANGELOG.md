# Changelog

All notable changes to `@probara/core` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-11-04

### Changed

- **Breaking, needs an action:** the automation key of a test no longer carries its parameters
  (`logs in [browser=chromium]` is now `logs in`). The parameters are sent with each result instead.
  A case reported with an earlier key is not matched by this version
  ([upgrading](../cli/docs/upgrade.md#070-the-parameters-are-not-part-of-the-key)).
- A result is sent with its `identity.parameters` (such as a Playwright project) as well as its own
  parameters; on a shared name the identity's value wins.

### Added

- `listRunCaseKeys` returns the `parameters` of each case when the server sends them.
- A report entry lists the names of its parameters that are reporter context in `contextParameters`: the
  identity's parameters (the framework's own, such as a Playwright project) are shown on the result and
  never become parameters of a case a report creates. It needs a server that accepts `contextParameters`,
  released together with the parameterized test cases server change.
