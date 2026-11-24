# @probara/cli

## 0.9.0

### Minor Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`c332c72`](https://github.com/cynch-me/probara-sdk/commit/c332c72fb6476bca8eaf1c091767d5fe71e7af39) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - `probara snap finalize` completes the Probara Snap build the machines of a Cypress run sent with
  `snap: true`, which join it without a total. A `--shard` run of Playwright or Vitest needs none. It names the build by the project, the build
  name (`--build-name`, `PROBARA_SNAP_BUILD_NAME`) and the nonce (`--nonce`, `PROBARA_SNAP_NONCE`,
  else what the CI gives), as the Cypress reporter does. Exit codes: 0 finalized, 1 when Probara refused or
  could not be reached, 2 on a usage error.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`f13d525`](https://github.com/cynch-me/probara-sdk/commit/f13d52564e47799ef8de85137c31631d092eaad4) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - `probara snap upload <dir>` sends every `.png` file under a directory, in its folders too, as the
  screenshots of one Probara Snap build, each named by its path from the directory without `.png`
  (`checkout/cart.png` is `checkout/cart`). `--browser`, `--viewport WxH` and `--color-mode` apply
  to them all; `--build-name`, `--nonce`, `--shard <index>/<total>`, `--parallel` and
  `--run-ulid` name the build as a reporter does. Exit codes: 0 sent, 1 when a `.png` file is not a PNG
  or Probara refused, 2 on a usage error (no directory, one that is missing or holds no `.png`, or no
  full commit or branch known).
  The commands docs show how to capture the stories of a Storybook and send them this way.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`f13d525`](https://github.com/cynch-me/probara-sdk/commit/f13d52564e47799ef8de85137c31631d092eaad4) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - `probara snap wait` waits until Probara has compared a Snap build, for a CI without the GitHub
  status Probara posts. It finds the build by `--build <ulid>`, else by the build name and the nonce
  (`--build-name`, `--nonce`, their `PROBARA_SNAP_*` variables, else what the CI gives), else by the
  commit the CI builds, and reads it every 5 seconds until it is complete, ends with an error or
  expires, or `--max-wait` seconds pass (15 minutes by default). Exit codes: 0 complete, 1 when the
  build ended with an error or expired, the wait timed out or Probara refused, 2 on a usage error,
  and 4 with `--fail-on-changes` when the build has changes its review did not accept (a reference build
  needs no review: only a rejected one exits 4). `--json`
  prints the build.

  In core, `waitForSnapBuild(options)` is that wait, with `sleep` and `now` as its clock, and the
  client gains `listSnapBuilds` (newest first, by name, branch, commit, nonce or run).

### Patch Changes

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`b3bc1b3`](https://github.com/cynch-me/probara-sdk/commit/b3bc1b33c048d46542baee40cd603be2e0501e95) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Follow the published API again. `listRunCaseKeys` reads the parameters of a case as the server
  lists them, by name and value, and still answers them as a record (`{ browser: 'chromium' }`):
  they were dropped before. The CLI docs no longer list the `case_archived` reason: a result that
  matches an archived case restores the case and is recorded.

- [#31](https://github.com/cynch-me/probara-sdk/pull/31) [`27f8e30`](https://github.com/cynch-me/probara-sdk/commit/27f8e309179deabacf7609beaa4db091f25aae9e) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Probara Snap: every screenshot carries the metadata Probara shows beside it. `uploadSnapScreenshots`
  sends the package that uploads (`sdk`, `@probara/core` unless the caller names its own), and a
  screenshot may carry its browser version, the URL of its page (only an `http` or `https` URL), the
  automation library and its version, and where its test is declared, its retries, annotations and
  tags. Values the Snap API would refuse are left out, and the screenshot is still sent. The
  Playwright reporter sends `@playwright/test` and its version, the browser version, the page's URL,
  the test's line and column, its `retries`, annotations and tags; the Cypress reporter sends Cypress
  and its version, the browser version, the page's URL and the test's `retries`; the Vitest reporter
  sends Vitest and its version, the page's URL, the test's `retries`, annotations, tags and location;
  `probara snap upload` names `@probara/cli`.
- Updated dependencies [[`b3bc1b3`](https://github.com/cynch-me/probara-sdk/commit/b3bc1b33c048d46542baee40cd603be2e0501e95), [`0e1cf3f`](https://github.com/cynch-me/probara-sdk/commit/0e1cf3feaad58597722f35cce00b64903a6a9ea4), [`a450722`](https://github.com/cynch-me/probara-sdk/commit/a4507220f633f67a9d14f4b9f44a4562dfed3fa8), [`7a8647b`](https://github.com/cynch-me/probara-sdk/commit/7a8647b0c1979a9856912f1f08935a36486c9900), [`f13d525`](https://github.com/cynch-me/probara-sdk/commit/f13d52564e47799ef8de85137c31631d092eaad4), [`6296481`](https://github.com/cynch-me/probara-sdk/commit/6296481296f31fb9504ae9ed6670e89a709cca63), [`02b9bd5`](https://github.com/cynch-me/probara-sdk/commit/02b9bd5270d2ebfc7a74ea2399cf21f02d58b121), [`64e6092`](https://github.com/cynch-me/probara-sdk/commit/64e6092c3775ef9a7f1f89bf5ecaf14560c0fa77), [`27f8e30`](https://github.com/cynch-me/probara-sdk/commit/27f8e309179deabacf7609beaa4db091f25aae9e)]:
  - @probara/core@0.9.0

## 0.8.2

### Patch Changes

- [`d511674`](https://github.com/cynch-me/probara-sdk/commit/d51167445076bea25e713541b878ed1265f212a5) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - `probara vis record` no longer misses a Ctrl+C (or SIGTERM) that comes while it injects the capture
  script into the page: the recording ends and is uploaded, as with a signal a moment later. Before,
  that signal was lost and the recording went on until the page closed or the next signal.

## 0.8.1

### Patch Changes

- Updated dependencies [[`f7c0004`](https://github.com/cynch-me/probara-sdk/commit/f7c00042ae7ccbd4d0177435f4cd74f2aac12439)]:
  - @probara/vis-capture@0.2.0

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

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`79a07d1`](https://github.com/cynch-me/probara-sdk/commit/79a07d1558a489bba12c7c5f571716dfdc4751b6) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New `probara vis record --cdp <endpoint>`: attaches over the Chrome DevTools Protocol to a browser an
  agent or a test runner drives, injects the capture engine of `@probara/vis-capture` into the page
  (`--target` picks it among several) and into every document it navigates to, and records the DOM
  replay with the console, the network requests and the user actions until a signal, `--duration`,
  the page closing or 60 minutes. The recording becomes a Vis of kind `replay`, with its environment,
  uploaded the way `vis create` uploads, with secrets redacted in the page and again before it is
  sent; its length never exceeds the limit, and when the plan allows less the Vis keeps the recording
  up to the plan limit. Nothing is created when nothing was captured.

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`2c62754`](https://github.com/cynch-me/probara-sdk/commit/2c627546e9dd8f391c6e7686893992c7d56c2c0b) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New `probara vis recording-links list|get|create|update|revoke|delete`: manages the recording links
  of the organization, URLs anyone records their screen with, no account needed, whose recordings
  arrive as Vises. `create` takes the title, folder and reference of the Vises the link receives,
  `--one-time`, `--expires` and `--[no-]microphone`, and prints the ULID and the URL of the link;
  `revoke` and `delete` ask for a confirmation unless `--yes` is given. The core client gains the
  recording link endpoints these commands call (`listVisRecordingLinks`, `getVisRecordingLink`,
  `createVisRecordingLink`, `updateVisRecordingLink`, `revokeVisRecordingLink`,
  `deleteVisRecordingLink`) and their types.

### Patch Changes

- [#18](https://github.com/cynch-me/probara-sdk/pull/18) [`06c987a`](https://github.com/cynch-me/probara-sdk/commit/06c987af3f5379595fb841a5ed5903ddf1153061) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - A second Ctrl+C during the upload of `probara vis record` no longer retries anything: the requests
  in flight end at once, the pending Vis gets one deletion attempt, and one line says whether it was
  deleted or left for Probara to delete seven days after its creation.
- Updated dependencies [[`f59373a`](https://github.com/cynch-me/probara-sdk/commit/f59373afc9f54d1aea9398ca95d95bbab10414a0), [`06c987a`](https://github.com/cynch-me/probara-sdk/commit/06c987af3f5379595fb841a5ed5903ddf1153061), [`2c62754`](https://github.com/cynch-me/probara-sdk/commit/2c627546e9dd8f391c6e7686893992c7d56c2c0b), [`b2fc7ff`](https://github.com/cynch-me/probara-sdk/commit/b2fc7ff150dbe217043bee98363930b48c5225ff), [`04b4718`](https://github.com/cynch-me/probara-sdk/commit/04b4718c80e2d87ff7417148792e96ad0eb76e39), [`cd981b6`](https://github.com/cynch-me/probara-sdk/commit/cd981b6ab9f3be7d38a7c4475a2a976f6f594490)]:
  - @probara/core@0.8.0
  - @probara/vis-capture@0.1.0

## 0.7.1

### Patch Changes

- [#16](https://github.com/cynch-me/probara-sdk/pull/16) [`462fc2c`](https://github.com/cynch-me/probara-sdk/commit/462fc2c8a3a8b758475f1fae608dc924ec5ad779) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - Published from GitHub Actions with npm provenance, so npm shows the commit and workflow that built each version.
- Updated dependencies [[`462fc2c`](https://github.com/cynch-me/probara-sdk/commit/462fc2c8a3a8b758475f1fae608dc924ec5ad779)]:
  - @probara/core@0.7.1

## 0.7.0

### Changed

- **Breaking, needs an action:** a Playwright test's automation key no longer ends with its project
  (`[project=chromium]`). The projects of a test share one key and one case, and the project is sent
  as the `project` parameter of each result; the Playwright JUnit dialect changes the same way. A test
  imported before this version is not matched by the next import, which creates a new case
  ([upgrading](docs/upgrade.md#070-the-parameters-are-not-part-of-the-key)).

### Added

- The Playwright JUnit dialect's project is sent as a context parameter, listed in `contextParameters`:
  shown on the result, never a parameter of a case a report creates. It needs a server that accepts
  `contextParameters`, released together with the parameterized test cases server change.

## 0.6.0

### Added

- `probara run close` without a run ULID, in GitHub Actions, closes the run the jobs of its
  workflow run reported into: run it in a final job with `needs` and `if: always()`
  ([GitHub Actions](docs/ci/github-actions.md#parallel-jobs-one-run-closed-by-the-final-job)).
  A run that is already closed (409 `ci_run_closed`) exits 0.
- In GitHub Actions the run's source names the workflow run (`provider`, `repository`, `ciRunId`,
  `ciRunAttempt`) along with the commit author, pull request, workflow and job, so every job that
  imports without a run ULID goes into one run.
- An import after the run of its workflow run was closed (409 `ci_run_closed`) exits 1 and says
  why.
- Parallel GitHub Actions jobs share the run of their workflow run by leaving it open with
  `--no-close-run` (or `PROBARA_CLOSE_RUN=false`); `--close-run` keeps its default, so a single job
  still closes its run.

### Changed

- With `provider: github_actions`, a commit that is not a 7 to 40 character hex SHA is left out
  with a warning.

## 0.5.0

### Changed

- The Cucumber docs point cucumber-js users at `@probara/cucumber-reporter`, which reports at the end of
  the run, with its attachments. `import cucumber` stays for Cucumber-JVM, playwright-bdd and other tools that
  write Cucumber JSON.
- The Cucumber step status and scenario rollup helpers, and the Gherkin step helpers, moved to
  `@probara/core`, which the formatter shares. The CLI behaves as before.

### Added

- `probara sync gherkin <globs...>` syncs the scenarios of `.feature` files with the synced cases of
  a project. The files are parsed with the official Gherkin parser; each scenario is keyed
  `<path> > <Feature> > <Scenario>`. A sync touches only the cases under its arguments, so each folder
  can have its own job, and `--dry-run` shows the outcome first. `--file-url`, `--suite-ulid`,
  `--root-dir` and `--json` complete it. A link to each scenario comes from `--file-url` or from the
  CI (GitHub Actions, GitLab CI, Bitbucket Pipelines, Azure Pipelines). See [Gherkin](docs/gherkin.md).
- `probara import cucumber <file.json...>` imports Cucumber JSON reports (cucumber-js, Cucumber-JVM,
  Reqnroll, playwright-bdd) as the results of their scenarios. Each step keeps its keyword, and each
  row of a Scenario Outline keeps its values as parameters. Each scenario is keyed as the sync keys it,
  from its feature file when that is there. It takes the options of `import junit`, and
  `--fail-on-failed-tests` exits 3 for a failed scenario. See
  [Results](docs/gherkin.md#results-probara-import-cucumber).

### Changed

- The help of `--dry-run` says what a dry run does for each command: it shows what a real run would
  do and writes nothing, and `probara sync gherkin --dry-run` needs the token and the project.

## 0.4.0

### Added

- The `vitest` dialect of `probara import junit` (`--dialect vitest`), detected per file in the
  reports of Vitest's built-in junit reporter (`vitest run --reporter=junit`), for Vitest 3.2, 4.1
  and 5.0. A test is keyed by its file and its title path: its describes and its title, split on
  `>` with a space on each side ([Vitest](docs/junit.md#vitest)). A report is read as `vitest` only
  when its root is named `vitest tests`, so no other tool's file changes its keys. Vitest 5's
  unhandled errors are not tests: the import leaves them out and prints one warning per file, and
  `--fail-on-failed-tests` exits 3 when it left any out.

## 0.3.0

### Added

- The `cypress-junit` dialect of `probara import junit` (`--dialect cypress-junit`), detected per
  file in the reports Cypress's built-in `junit` reporter and
  [cypress-junit](https://www.npmjs.com/package/cypress-junit) write: the spec
  path and the full title of each test, one title segment, so the keys match the ones
  `@probara/cypress-reporter` reports with
  ([Cypress](docs/junit.md#cypress)). A report is read as `cypress-junit` only when every mark of
  that writer is there (a `Mocha Tests` root, one testsuite naming a `cypress/` or `*.cy.*` spec, and
  a classname every name ends with), so no other tool's file changes its keys.

## 0.2.0

One change needs an action before you upgrade: a project code must now be written as in Probara,
in capitals (`SHOP`, not `shop`). See **Changed**.

### Changed

- **Breaking, needs an action:** a project code (`--project`, `PROBARA_PROJECT`, the `project` of
  a results file) must be a capital letter, then capital letters or digits, as in Probara: any
  other value, such as `shop`, is an error (exit 2) before any request, in a dry run too. Write
  the code as Probara shows it.

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

## 0.1.0

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
