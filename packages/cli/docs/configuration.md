# Configuration

Every setting has a flag, and most have a `PROBARA_*` variable too. Set the token and the project
once as CI variables, and pass flags for what changes from one command to the next.

## Quick path

1. Create an app token from the **JUnit XML** card in **Integrations**
   ([get a token](#get-a-token)), and store it as a CI secret named `PROBARA_API_TOKEN`. It is
   only read from the environment ([why](#why-there-is-no---token-flag)).
2. Set `PROBARA_PROJECT` to the project code (such as `SHOP`), or pass `--project SHOP`.
3. Everything else has a default. Branch, commit and build URL come from the CI on their own.

## Get a token

Report with an app token. It belongs to your organization, not to a person:

1. As an admin or owner, open **Integrations** in Probara and pick the **JUnit XML** card.
2. Create a token, and name it after what uses it (such as the repository or the pipeline).
3. Copy the secret, which starts with `probara_app_`. It is shown once: store it as the CI secret
   `PROBARA_API_TOKEN` right away.

What an app token is:

- It uses no seat, and it keeps working when the person who created it leaves the organization.
- Its runs and results show the app (JUnit XML) and the token's name, not a person.
- It can only do what the CLI does: create automated runs, send reports (which can create cases
  and suites), upload result attachments and close runs.
- Revoke it from the same card when it may have leaked, then create a new one.

Reporting from CI needs a paid plan: on the free plan, Probara answers `403 forbidden`
([401 or 403](troubleshooting.md#probara-answers-401-or-403)). A personal API token also works
on a paid plan, with the permissions of its user, but an app token is the one to use in CI.

## Sources and precedence

The first source that sets a value wins:

| Order | Source            | Example                                                 |
| ----- | ----------------- | ------------------------------------------------------- |
| 1     | A flag            | `--run-name "Release 2.4"`                              |
| 2     | A `PROBARA_*` var | `PROBARA_RUN_NAME=Nightly`                              |
| 3     | CI detection      | `CI #42` from `GITHUB_WORKFLOW` and `GITHUB_RUN_NUMBER` |
| 4     | The default       | `Automated run 2026-09-29 14:05 UTC`                    |

CI detection only fills the run's name and its source (branch, commit and build URL): see
[what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection). A flag that is not given never hides its
variable, and a blank variable counts as unset. Booleans accept `true`, `1`, `yes`, `on` and
`false`, `0`, `no`, `off`.

### Worked example

A GitHub Actions job (`GITHUB_WORKFLOW=CI`, run number 42) names its run from the CI:

<!-- output: dry-run-log -->

```text
$ GITHUB_ACTIONS=true GITHUB_WORKFLOW=CI GITHUB_RUN_NUMBER=42 probara import junit junit.xml --dry-run
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "CI #42"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Dry run: nothing was sent
```

`PROBARA_RUN_NAME` wins over the CI:

<!-- output: dry-run-log -->

```text
$ GITHUB_ACTIONS=true GITHUB_WORKFLOW=CI GITHUB_RUN_NUMBER=42 PROBARA_RUN_NAME=Nightly probara import junit junit.xml --dry-run
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Nightly"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Dry run: nothing was sent
```

And `--run-name` wins over both:

<!-- output: dry-run-log -->

```text
$ GITHUB_ACTIONS=true GITHUB_WORKFLOW=CI GITHUB_RUN_NUMBER=42 PROBARA_RUN_NAME=Nightly probara import junit junit.xml --dry-run --run-name "Release 2.4"
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Release 2.4"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Dry run: nothing was sent
```

The flags become options of [`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#configuration), and core reads
the environment itself, so every Probara tool resolves settings the same way.

## Options

The **Core option** column names the setting in error messages: `--run-ulid not-a-ulid` fails with
`run.ulid is not a ULID`, and a bad variable is named as such (`PROBARA_CLOSE_RUN must be true or
false`). Messages never print the value. List options repeat (`--tag a --tag b`) or take commas
(`--tag a,b`); their variables take commas.

<!-- options-table -->

| Flag                           | Description                                                                                          | Variable                       | Core option              | Default                                                    | Values                                                                     | Commands                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| `--project <code>`             | Project code, such as SHOP                                                                           | `PROBARA_PROJECT`              | `projectId`              | —                                                          | —                                                                          | import junit, import results, run create, run close |
| `--projects <code>`            | Another project whose cases results may go to, each in its own run (repeatable, or comma-separated)  | `PROBARA_PROJECTS`             | `projects`               | —                                                          | —                                                                          | import junit, import results                        |
| `--base-url <url>`             | Probara URL                                                                                          | `PROBARA_BASE_URL`             | `baseUrl`                | `https://app.probara.net`                                  | —                                                                          | import junit, import results, run create, run close |
| `--run-ulid <ulid>`            | An existing run: import into it instead of creating one, or close it                                 | `PROBARA_RUN_ULID`             | `run.ulid`               | —                                                          | —                                                                          | import junit, import results, run close             |
| `--run-ulids <code=ulid>`      | An existing run of a project to import into, such as WEB=<ulid> (repeatable, or comma-separated)     | `PROBARA_RUN_ULIDS`            | `run.ulids`              | —                                                          | —                                                                          | import junit, import results                        |
| `--run-name <name>`            | Name of a new run                                                                                    | `PROBARA_RUN_NAME`             | `run.name`               | `the CI build name, else "Automated run <date> UTC"`       | —                                                                          | import junit, import results, run create            |
| `--run-description <text>`     | Description of a new run                                                                             | `PROBARA_RUN_DESCRIPTION`      | `run.description`        | —                                                          | —                                                                          | import junit, import results, run create            |
| `--environment-id <ulid>`      | Environment of a new run                                                                             | `PROBARA_ENVIRONMENT_ID`       | `run.environmentId`      | —                                                          | —                                                                          | import junit, import results, run create            |
| `--environment <name>`         | Environment of a new run by name                                                                     | `PROBARA_ENVIRONMENT`          | `run.environment`        | —                                                          | —                                                                          | import junit, import results, run create            |
| `--milestone-id <ulid>`        | Milestone of a new run                                                                               | `PROBARA_MILESTONE_ID`         | `run.milestoneId`        | —                                                          | —                                                                          | import junit, import results, run create            |
| `--milestone <ref>`            | Milestone of a new run by display id (M-3) or name                                                   | `PROBARA_MILESTONE`            | `run.milestone`          | —                                                          | —                                                                          | import junit, import results, run create            |
| `--plan <ref>`                 | Test plan of a new run by display id (PLAN-2) or name                                                | `PROBARA_PLAN`                 | `run.plan`               | —                                                          | —                                                                          | import junit, import results, run create            |
| `--configuration <ulid>`       | Configuration of a new run (repeatable, or comma-separated)                                          | `PROBARA_CONFIGURATION_ULIDS`  | `run.configurationUlids` | —                                                          | —                                                                          | import junit, import results, run create            |
| `--configuration-value <pair>` | Configuration of a new run by name, such as Browser=Chrome (repeatable, or comma-separated)          | `PROBARA_CONFIGURATIONS`       | `run.configurations`     | —                                                          | —                                                                          | import junit, import results, run create            |
| `--tag <tag>`                  | Tag of a new run (repeatable, or comma-separated)                                                    | `PROBARA_RUN_TAGS`             | `run.tags`               | —                                                          | —                                                                          | import junit, import results, run create            |
| `--branch <name>`              | Branch of the run source                                                                             | `PROBARA_BRANCH`               | `source.branch`          | detected from the CI                                       | —                                                                          | import junit, import results, run create            |
| `--commit <sha>`               | Commit of the run source                                                                             | `PROBARA_COMMIT`               | `source.commit`          | detected from the CI                                       | —                                                                          | import junit, import results, run create            |
| `--build-url <url>`            | CI build URL of the run source                                                                       | `PROBARA_BUILD_URL`            | `source.buildUrl`        | detected from the CI                                       | —                                                                          | import junit, import results, run create            |
| `--no-source`                  | Send no run source (branch, commit, build URL)                                                       | —                              | `source`                 | —                                                          | —                                                                          | import junit, import results, run create            |
| `--[no-]create-missing-cases`  | Create a case for a test that matches none                                                           | `PROBARA_CREATE_MISSING_CASES` | `createMissingCases`     | `true`                                                     | —                                                                          | import junit, import results                        |
| `--suite-ulid <ulid>`          | Suite that created cases go under                                                                    | `PROBARA_SUITE_ULID`           | `suiteUlid`              | the project root                                           | —                                                                          | import junit, import results                        |
| `--[no-]close-run`             | Close the run after the import                                                                       | `PROBARA_CLOSE_RUN`            | `closeRun`               | true for a new run, false for an existing one (--run-ulid) | —                                                                          | import junit, import results                        |
| `--[no-]attachments`           | Upload the files the reports reference                                                               | `PROBARA_UPLOAD_ATTACHMENTS`   | `uploadAttachments`      | `true`                                                     | —                                                                          | import junit, import results                        |
| `--attach-output`              | Also attach each testcase's system-out and system-err as text files                                  | —                              | —                        | —                                                          | —                                                                          | import junit                                        |
| `--dialect <name>`             | JUnit dialect of every file, instead of detecting it per file                                        | —                              | —                        | `auto`                                                     | `auto`, `jest`, `pytest`, `playwright`, `surefire`, `gotestsum`, `generic` | import junit                                        |
| `--error-status <status>`      | Status of a testcase with an `<error>`                                                               | —                              | —                        | `failed`                                                   | `failed`, `blocked`                                                        | import junit                                        |
| `--status-mapping <from=to>`   | Send the results of one status with another, such as failed=blocked (repeatable, or comma-separated) | `PROBARA_STATUS_MAPPING`       | `statusMapping`          | —                                                          | —                                                                          | import junit, import results                        |
| `--status-filter <status>`     | Send no result with this status, after --status-mapping (repeatable, or comma-separated)             | `PROBARA_STATUS_FILTER`        | `statusFilter`           | —                                                          | —                                                                          | import junit, import results                        |
| `--root-dir <dir>`             | Directory the file paths of automation keys are relative to                                          | —                              | `rootDir`                | the current directory                                      | —                                                                          | import junit, import results                        |
| `--fail-on-failed-tests`       | Exit 3 when a test failed or was blocked                                                             | —                              | —                        | —                                                          | —                                                                          | import junit                                        |
| `--dry-run`                    | Print what would be sent, and send nothing (no token needed)                                         | —                              | —                        | —                                                          | —                                                                          | import junit, import results                        |
| `--results-file <path>`        | JSON file the results that were not sent are written to                                              | `PROBARA_RESULTS_FILE`         | `resultsFile`            | —                                                          | —                                                                          | import junit                                        |
| `--timeout <ms>`               | Timeout of one HTTP attempt, in milliseconds                                                         | —                              | `timeoutMs`              | `30000`                                                    | —                                                                          | import junit, import results, run create, run close |
| `--max-retries <n>`            | Retries of a failed request, 0 to 10                                                                 | —                              | `maxRetries`             | `4`                                                        | —                                                                          | import junit, import results, run create, run close |
| `--chunk-size <n>`             | Results per report request, 1 to 500                                                                 | —                              | `chunkSize`              | `500`                                                      | —                                                                          | import junit, import results                        |
| `--attachment-concurrency <n>` | Results whose attachments upload at the same time, 1 to 8                                            | —                              | `attachmentConcurrency`  | `2`                                                        | —                                                                          | import junit, import results                        |
| `--json`                       | Print a JSON summary on stdout                                                                       | —                              | —                        | —                                                          | —                                                                          | import junit, import results, run create, run close |
| `--debug`                      | Log every request                                                                                    | `PROBARA_DEBUG`                | `debug`                  | `false`                                                    | —                                                                          | import junit, import results, run create, run close |
| `-h, --help`                   | Show this help                                                                                       | —                              | —                        | —                                                          | —                                                                          | import junit, import results, run create, run close |

Variables without a flag:

| Variable            | Meaning                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `PROBARA_API_TOKEN` | The app token ([get a token](#get-a-token)). Required, except for a dry run.      |
| `PROBARA_ENABLED`   | `false` turns reporting off: nothing is sent ([details](#turning-reporting-off)). |

### Options of a new run

`--run-name`, `--run-description`, `--environment`, `--milestone`, `--plan`,
`--configuration-value`, their ULID forms `--environment-id`, `--milestone-id` and
`--configuration`, `--tag`, `--branch`, `--commit`, `--build-url` and `--no-source` describe the
run that `import junit` or `run create` creates. With `--run-ulid` (or `PROBARA_RUN_ULID`) the run
exists already: the run fields are ignored with a warning, and `import junit` leaves the run open
unless `--close-run` is given.

The environment, milestone and configurations take a name or a ULID, never both (both is an error,
exit 2). Names are what an app token can use, since it cannot look ULIDs up:

- `--environment staging` matches an environment of the project by name, and creates it when none
  matches.
- `--milestone` and `--plan` take a display id (`M-3`, `PLAN-2`) or the exact name. A plan seeds
  the new run with the cases it selects; reported cases join them.
- `--configuration-value Browser=Chrome` names a configuration value by its group and its name
  (split at the first `=`), each group once; `PROBARA_CONFIGURATIONS=Browser=Chrome,OS=Linux`
  holds several.

Probara refuses an unknown milestone, plan or configuration (the import exits 1 and records
nothing), naming the field.

```bash
probara run create --environment staging --milestone "Sprint 12" --configuration-value Browser=Chrome
```

### Limits

Core keeps every value inside the API's limits, with a warning when it has to cut: a run name of
200 characters, 50 tags of 80 characters, 20 configurations. `--chunk-size`, `--max-retries`,
`--timeout` and `--attachment-concurrency` outside their range are an error (exit 2). The full list
is in [what core normalizes](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#what-core-normalizes).

## Status mapping and filter

`--status-mapping` sends the results of one status with another, and `--status-filter` sends no
result with the given statuses. The mapping applies first, so the filter sees the mapped status.
Both take `passed`, `failed`, `skipped` and `blocked`, in any case; the mapping takes
`<from>=<to>` pairs. The variables work the same way: `PROBARA_STATUS_MAPPING=failed=blocked` and
`PROBARA_STATUS_FILTER=skipped`.

A dry run shows each entry with the status it would be sent with, and marks the ones the filter
leaves out:

<!-- output: dry-run-stdout -->

```text
$ probara import junit junit.xml --dry-run --status-mapping failed=blocked --status-filter skipped
passed	-	login PRB-12 logs in with a valid password
blocked	-	login rejects a wrong password
blocked	-	login crashes on an unexpected exception
skipped	-	login supports SSO (skipped: SSO provider not configured)	filtered: not sent
passed	-	login session refresh renews the token before expiry
passed	-	login username alice has length 5
passed	-	login username bob has length 3
passed	-	login prints to stdout and stderr
passed	-	login accepts café and ñandú
passed	-	[PRB-13] top-level test outside any describe
Total: 10 results from 1 file (7 passed, 2 failed, 1 skipped, 0 blocked); 1 filtered out, not sent
```

The mapping and the filter change what is sent, not the test outcomes: the `Results:` line, the
`tests` counts of `--json` and `--fail-on-failed-tests` (exit 3) still count the statuses of the
JUnit files. The summary of a real import counts the results left out in `filtered`. An unknown
status, a pair without `=` or a status mapped twice is an error (exit 2).

## Why there is no `--token` flag

A command line is visible to every user of the machine (`ps`), and CI systems print the commands
they run. The token is read from `PROBARA_API_TOKEN` only, and the CLI refuses a `--token` or
`--api-token` flag without echoing its value:

<!-- output: import -->

```text
$ probara import junit junit.xml --token prb_secret
[probara] There is no --token option: set the API token in the PROBARA_API_TOKEN variable (a command line shows up in process lists and CI logs). Run "probara import junit --help" for usage.
```

## Why there is no config file

Everything a CI job needs is in its environment or on its command line, where the CI's own
tooling (secrets, variables, matrices) already manages it. A config file would add a third source
to the precedence, a discovery rule to learn, and a place where a token could be committed by
mistake.

## Turning reporting off

`PROBARA_ENABLED=false` makes every command send nothing and exit 0, with two exceptions: the
options and files are still checked, so a wrong option or a broken report still exits 2; and
`--fail-on-failed-tests` still exits 3 when tests failed, since they did. Use it for local runs or
for jobs that must not report:

<!-- output: disabled -->

```text
$ probara import junit junit.xml
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Probara reporting is disabled by PROBARA_ENABLED: nothing was sent
```

With `--results-file` (or `PROBARA_RESULTS_FILE`), an import with reporting off writes every
result to that file instead (to its first free sibling, `<name>-2.json`, when a file is already
there), to send later with [`probara import results`](commands.md#probara-import-results).

A dry run ignores `PROBARA_ENABLED`: it always prints what would be sent. Without a token and a
project the CLI does **not** stay quiet: it exits 2, so a job that lost its secret is noticed (see
[fork pull requests](troubleshooting.md#fork-pull-requests-fail-with-exit-2)).

## Self-hosted Probara and the base URL

Point the CLI at another Probara with `--base-url` or `PROBARA_BASE_URL`: the URL of the app, which
also serves the API under `/api/v1`. It must be `http` or `https`, without a query or a fragment; a
trailing `/` is removed.

```bash
PROBARA_BASE_URL=https://probara.example.com probara import junit junit.xml
probara import junit junit.xml --base-url https://probara.example.com
```

The run links in the log use the same base URL. For a private certificate authority or a proxy,
see [network](network.md).

## See also

- [Commands](commands.md): the `--help` of every command.
- [Linking tests to cases](linking.md): `--project`, `--no-create-missing-cases`, `--suite-ulid`.
- [`@probara/core` configuration](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#configuration).
