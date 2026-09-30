# Changelog

All notable changes to `@probara/cli` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in
[upgrading](docs/upgrade.md).

## [Unreleased]

## [0.1.0] - 2026-09-29

The first version of the CLI, and the first one published on npm.

### Added

- `probara import junit <paths...>` imports JUnit XML files into one Probara run. Paths are files,
  directories (every `*.xml` beneath them) or globs; every file is parsed before anything is sent,
  so one invalid file sends nothing ([commands](docs/commands.md)).
- JUnit dialects for Jest (jest-junit), pytest, Playwright, Maven Surefire and gotestsum, detected
  per file, plus a generic dialect for any other JUnit writer; `--dialect` overrides the detection
  ([JUnit mapping](docs/junit.md)).
- Linking by `probara_case` properties and by case ids (`SHOP-12`, `SHOP_12`) in test names. Ids
  are removed from titles and automation keys, so adding one never changes a key; a test with
  several ids fans out to one result per case ([linking](docs/linking.md)).
- Automation keys built by `@probara/core` (automation key v1), so the same test lands on the same
  case on every import; `--no-create-missing-cases` only links to existing cases.
- Statuses from `<failure>`, `<error>` (`--error-status blocked` records errors as blocked) and
  `<skipped>`; flaky and rerun attempts (Surefire, Playwright `includeRetries`) summarized in the
  notes; durations and execution times, with jest-junit's UTC timestamps read as UTC.
- Attachments from `[[ATTACHMENT|path]]` lines and `probara_attachment` properties, resolved next
  to the report; `--attach-output` attaches each testcase's output as text files;
  `--no-attachments` turns uploads off ([attachments](docs/attachments.md)).
- `probara run create` and `probara run close` for sharded CI: create one run, report into it from
  every shard with `PROBARA_RUN_ULID`, then close it ([sharded runs](docs/ci/sharding.md)).
- Configuration from flags and `PROBARA_*` variables, over CI detection (GitHub Actions, GitLab CI,
  CircleCI, Azure Pipelines, Jenkins, Bitbucket Pipelines, Buildkite), over defaults. The token is
  only read from `PROBARA_API_TOKEN`: there is no `--token` flag ([configuration](docs/configuration.md)).
- Exit codes: 0 reported, 1 reporting failed, 2 usage or input error, 3 failed tests with
  `--fail-on-failed-tests` ([exit codes](docs/exit-codes.md)).
- `--dry-run` prints what would be sent without a token; `--json` prints a summary on stdout;
  `--debug` logs every request. Logs go to stderr, and the token is redacted from every output
  ([debugging](docs/debugging.md)).
- Retries with backoff and `Retry-After`, per-attempt timeouts and idempotency keys from
  `@probara/core` ([network](docs/network.md)).
- The docs say where the token comes from: an app token, created from the **JUnit XML** card in
  **Integrations**, is the credential for CI. Reporting from CI needs a paid plan, and a 403 on
  the free plan is explained ([get a token](docs/configuration.md#get-a-token)).

### Fixed

- `probara run create` failed against Probara with 422 `validation_failed`, because the run it
  created had no cases. It now creates an empty automated run (`automated: true`), which needs a
  Probara version that accepts automated runs
  ([`run create`](docs/commands.md#probara-run-create)).
