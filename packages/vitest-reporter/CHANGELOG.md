# Changelog

All notable changes to `@probara/vitest-reporter` are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

The first version of the reporter.

### Added

- A Vitest reporter, `['@probara/vitest-reporter', { projectId: 'SHOP' }]` after `default` in the
  reporters of the Vitest config, that sends every test result of a run to one Probara run, closed
  at the end, configured by its options and `PROBARA_*` variables, options first
  ([configuration](docs/configuration.md)). Requires Node.js 22.12 and Vitest 3.2, 4 or 5; the
  package is an ES module.
- The reporter adds its setup file and its runner to every Vitest project: nothing goes in
  `setupFiles` or `runner`.
- The automation keys `probara import junit` gives Vitest's JUnit output, on Vitest 3, 4 and 5, so
  a project can switch from the JUnit import without losing a case; `keyIncludesFile: false`
  (`PROBARA_KEY_INCLUDES_FILE`) leaves the file out
  ([same cases as the JUnit import](README.md#same-cases-as-the-junit-import)).
- One result per attempt of `retry` and per execution of `repeats`, with Vitest's verdict:
  `test.fails` honored, skipped tests, `todo` with the note `Todo`, `context.skip(note)` with the
  note `Skipped: <note>`, every error of an attempt in its notes (`expect.soft` included), and a
  failed result for a `beforeAll` or `afterAll` that throws and for a file that fails to load
  ([statuses](docs/statuses.md), [retries and repeats](docs/retries.md)).
- Linking by case ids in titles and describes (`SHOP-12 adds an item`) and `probara.id()`; a test
  linked to several cases is sent once per case ([linking](docs/linking.md)).
- `probara.*` helpers, imported from `@probara/vitest-reporter`, in Node (`test.concurrent` tests
  included) and in browser mode: `id`, `title`, `suite`, `comment`, `ignore`, `tags`, `fields`,
  `parameters`, `attach` (awaited; a file or a body, copied when called),
  `step(title, body?, { expected, data })`, `link(url, name?)` and `issue(id)`
  ([metadata](docs/metadata.md), [steps](docs/steps.md), [attachments](docs/attachments.md),
  [links](docs/links.md)). A call Probara cannot use is left out with a warning; nothing throws
  into a test.
- Vitest's own files with each result: the attachments of `context.annotate()` and the failure
  screenshots of browser mode (`attachScreenshots`, `PROBARA_ATTACH_SCREENSHOTS`); with
  `captureOutput` (`PROBARA_CAPTURE_OUTPUT`), each attempt's console output as `stdout.log` and
  `stderr.log` ([captured output](docs/output.md)).
- Vitest tags (4.1 and later) join the tags of a created case, and a run of several Vitest projects
  names each result's project in its `project` parameter ([projects](docs/projects.md)).
- Runs by name, environment, milestone, test plan, configurations, description and tags, and the
  CI source ([run options](docs/runs.md)); one run per `--watch` session, never closed by the
  reporter ([watch mode](docs/watch.md)); one run for a sharded job, merged from its blob reports
  or shared with `probara run create` and `PROBARA_RUN_ULID` ([sharding](docs/ci/sharding.md));
  several Probara projects with `projects` and `run.ulids`.
- `runCasesOnly` (`PROBARA_RUN_CASES_ONLY`), which runs only the tests of the cases of a Probara
  run ([run selection](docs/run-selection.md)); `assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO`)
  ([assign failed results](docs/assign-failed.md)); `issueUrlTemplate`
  (`PROBARA_ISSUE_URL_TEMPLATE`), the URL each `probara.issue(id)` becomes.
- A results file (`resultsFile`) for what could not be sent, with the attached files next to it in
  `<name>-attachments/`, sent later by `probara import results 'probara-results*.json'`
  ([results file](docs/results-file.md)).
- The reporter never throws into Vitest and never changes its exit code; reporting problems are
  logged on stderr, never with the token ([troubleshooting](docs/troubleshooting.md)).
- Documentation for every feature, each example run against the real reporter in a real Vitest by
  the docs tests: CI guides for GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Jenkins,
  Bitbucket Pipelines and Buildkite, and guides from the JUnit import, Qase, Allure, ReportPortal
  and TestRail, with what is not supported and why.
