# @probara/core

## 0.7.1

### Patch Changes

- [#16](https://github.com/cynch-me/probara-sdk/pull/16) [`462fc2c`](https://github.com/cynch-me/probara-sdk/commit/462fc2c8a3a8b758475f1fae608dc924ec5ad779) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Published from GitHub Actions with npm provenance, so npm shows the commit and workflow that built each version.

## 0.7.0

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
