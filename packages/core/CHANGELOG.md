# @probara/core

## 0.8.0

### Minor Changes

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`f59373a`](https://github.com/cynch-me/probara-sdk/commit/f59373afc9f54d1aea9398ca95d95bbab10414a0) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New `probara vis` commands: `list`, `get`, `create`, `update` and `delete`. `vis create <file>`
  uploads a video (MP4 or WebM, in 8 MiB parts) or an image (PNG, JPEG or WebP) as a Vis, and
  `--playwright-trace <trace.zip>` attaches the console, the network and the user actions of a
  Playwright trace, with secrets redacted before anything is sent. The core client gains the Vis
  endpoints these commands call. The Vis commands need a personal API token.

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`06c987a`](https://github.com/cynch-me/probara-sdk/commit/06c987af3f5379595fb841a5ed5903ddf1153061) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - `probara vis record` reads the plan's longest recording from Probara before the recording starts
  and stops there, saying so with the plan's limit; `--duration` cannot go past it, and a plan
  without a limit records until it is stopped. When the limit cannot be read, the recording keeps
  its 60 minutes as before; the command waits at most 3 seconds for it, and Ctrl+C while it waits
  ends the command before anything is recorded or created. The core client reads the organization's Vis settings with the plan's
  limits: `getVisSettings()` (`GET /api/v1/vis-settings`), with the `VisSettings` and
  `VisPlanLimits` types and `VIS_UNLIMITED`.

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`2c62754`](https://github.com/cynch-me/probara-sdk/commit/2c627546e9dd8f391c6e7686893992c7d56c2c0b) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New `probara vis recording-links list|get|create|update|revoke|delete`: manages the recording links
  of the organization, URLs anyone records their screen with, no account needed, whose recordings
  arrive as Vises. `create` takes the title, folder and reference of the Vises the link receives,
  `--one-time`, `--expires` and `--[no-]microphone`, and prints the ULID and the URL of the link;
  `revoke` and `delete` ask for a confirmation unless `--yes` is given. The core client gains the
  recording link endpoints these commands call (`listVisRecordingLinks`, `getVisRecordingLink`,
  `createVisRecordingLink`, `updateVisRecordingLink`, `revokeVisRecordingLink`,
  `deleteVisRecordingLink`) and their types.

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
