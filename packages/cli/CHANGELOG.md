# Changelog

All notable changes to `@probara/cli` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in
[upgrading](docs/upgrade.md).

## [Unreleased]

### Added

- `--assign-failed-to <email>` (`PROBARA_ASSIGN_FAILED_TO`, both imports) asks every report to
  assign each run case it leaves failed and without an assignee to one of up to 20 members, in
  turn; Probara's warning about emails that match no member is logged. A results file keeps the
  emails ([assigning failed results](docs/configuration.md#assigning-failed-results)).
- `probara import results` sends the links of each result a reporter kept in the file (an issue,
  a TMS page, a build log).

- `--status-mapping <from=to>` (`PROBARA_STATUS_MAPPING`) sends the results of one status with
  another, and `--status-filter <status>` (`PROBARA_STATUS_FILTER`) sends no result with that
  status, after the mapping. A dry run shows the mapped statuses and marks the filtered entries;
  the test counts and `--fail-on-failed-tests` still follow the JUnit outcomes
  ([status mapping and filter](docs/configuration.md#status-mapping-and-filter)).
- The `--json` summary counts the results the status filter left out in `filtered`, and the
  `--dry-run --json` document lists them in `filtered`.
- `--run-description <text>`, `--environment <name>`, `--milestone <ref>`, `--plan <ref>` and
  `--configuration-value <pair>` (`PROBARA_RUN_DESCRIPTION`, `PROBARA_ENVIRONMENT`,
  `PROBARA_MILESTONE`, `PROBARA_PLAN`, `PROBARA_CONFIGURATIONS=Browser=Chrome,OS=Linux`) describe
  a new run by name, which an app token can use; a name and a ULID for the same reference is an
  error (exit 2) ([options of a new run](docs/configuration.md#options-of-a-new-run)).
- The `--json` summary lists what Probara skipped without failing a report in `warnings`.
- `--projects <code>` (`PROBARA_PROJECTS`) sends the results linked to cases of other projects,
  each into a run of its project, and `--run-ulids <code=ulid>` (`PROBARA_RUN_ULIDS`) names the run
  to reuse in each one. A result linked to a project that is not listed is not sent, with one
  warning per project; ids of the listed projects link from test names too. The description and
  the environment by name go with every new run, while `--milestone`, `--plan`,
  `--configuration-value` and the ULID forms only apply to the project's run
  ([several projects](docs/linking.md#cases-of-several-projects)).
- `probara import junit --results-file <path>` (`PROBARA_RESULTS_FILE`) writes the results it could
  not send to a JSON file, or every result with reporting off. A file already there is never
  touched: the results go to its first free sibling (`<name>-2.json`, ...). Every write is atomic.
- `probara import results <paths...>` sends results files (paths or quoted globs, such as
  `'probara-results*.json'`), written by an import or a reporter such as
  `@probara/playwright-reporter`, each into the runs it names; flags, then variables, win over
  each file. Every file is checked before anything is sent (an empty file a glob matches is
  skipped with a warning). It consumes each file on its own: it deletes it (and its
  `<name>-attachments` folder) once every result in it was sent, and rewrites it atomically with
  only the results still unsent otherwise, so importing whatever is there never sends a result
  twice. No file matching exits 0; `--dry-run` and `PROBARA_ENABLED=false` leave
  every file as it is ([`import results`](docs/commands.md#probara-import-results)).
  The files stored in the `<name>-attachments/` folder are referenced relative to the file, so a
  results file and its folder moved elsewhere (a CI artifact another job downloads) still upload
  their attachments; other files keep their absolute paths. A results file is trusted input: its
  attachments are uploaded from the paths it names, so import only the files your own jobs wrote.
  An attachment whose relative path leads outside the folder of the file is left out with a
  warning; absolute paths are kept.

### Changed

- A project code (`--project`, `PROBARA_PROJECT`, the `project` of a results file) must be a
  capital letter, then capital letters or digits, as in Probara: any other value, such as `shop`,
  is an error (exit 2) before any request, in a dry run too.

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
