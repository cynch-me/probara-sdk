# Commands

`probara` has four commands. Each one reads its options from flags and `PROBARA_*` variables
([configuration](configuration.md)), logs on stderr and keeps stdout for machine output
([debugging](debugging.md)).

| Command                                             | Use it to                                            |
| --------------------------------------------------- | ---------------------------------------------------- |
| [`probara import junit`](#probara-import-junit)     | Import JUnit XML files into one run                  |
| [`probara import results`](#probara-import-results) | Send a results file: what a reporter could not send  |
| [`probara run create`](#probara-run-create)         | Create a run up front, for shards that share it      |
| [`probara run close`](#probara-run-close)           | Close a shared run once every shard reported into it |

The help below is the real output of each `--help`: the docs tests check it byte for byte.

## `probara`

<!-- help: probara -->

```text
Usage: probara <command> [options]

Report automated test results to Probara from any CI.

Commands:
  import junit <paths...>  Import JUnit XML files into one Probara run
  import results <file>    Send a results file: the results a reporter or an import could not send
  run create               Create a run for sharded CI and print its ULID
  run close                Close a run once every shard reported into it

Options:
  -h, --help  Show the help (of a command, after its name)
  --version   Print the version

Run "probara <command> --help" for the options of a command.
```

- `probara --version` prints the version on stdout.
- `probara` without a command prints this help on stderr and exits 2.
- `probara import --help` and `probara run --help` list the commands of each group:

<!-- help: import -->

```text
Usage: probara import <format> [options]

Commands:
  junit <paths...>  Import JUnit XML files into one Probara run
  results <file>    Send a results file: the results a reporter or an import could not send

Run "probara import <format> --help" for its options.
```

<!-- help: run -->

```text
Usage: probara run <command> [options]

Commands:
  create  Create a run for sharded CI and print its ULID
  close   Close a run once every shard reported into it

Run "probara run <command> --help" for its options.
```

## `probara import junit`

<!-- help: import junit -->

```text
Usage: probara import junit [options] <paths...>

Import JUnit XML files into one Probara run.

Each path is a file, a directory (every *.xml beneath it) or a glob, relative to the current
directory. Quote globs so the shell leaves them to probara. Every file is parsed before anything is
sent: one invalid file sends nothing.

Tests link to cases by a probara_case property or by a <PROJECT>-<n> id in their name; the others
match by automation key, and missing cases are created.

Options:
  --project <code>              Project code, such as SHOP; case ids in test names use it
                                env: PROBARA_PROJECT
  --projects <code>             Another project whose cases results may go to, each in its own run
                                (repeatable, or comma-separated)
                                env: PROBARA_PROJECTS
  --base-url <url>              Probara URL
                                env: PROBARA_BASE_URL
                                default: https://app.probara.net
  --run-ulid <ulid>             An existing run: import into it instead of creating one, or close it
                                env: PROBARA_RUN_ULID
  --run-ulids <code=ulid>       An existing run of a project to import into, such as WEB=<ulid>
                                (repeatable, or comma-separated)
                                env: PROBARA_RUN_ULIDS
  --run-name <name>             Name of a new run
                                env: PROBARA_RUN_NAME
                                default: the CI build name, else "Automated run <date> UTC"
  --run-description <text>      Description of a new run
                                env: PROBARA_RUN_DESCRIPTION
  --environment-id <ulid>       Environment of a new run
                                env: PROBARA_ENVIRONMENT_ID
  --environment <name>          Environment of a new run by name
                                env: PROBARA_ENVIRONMENT
  --milestone-id <ulid>         Milestone of a new run
                                env: PROBARA_MILESTONE_ID
  --milestone <ref>             Milestone of a new run by display id (M-3) or name
                                env: PROBARA_MILESTONE
  --plan <ref>                  Test plan of a new run by display id (PLAN-2) or name
                                env: PROBARA_PLAN
  --configuration <ulid>        Configuration of a new run (repeatable, or comma-separated)
                                env: PROBARA_CONFIGURATION_ULIDS
  --configuration-value <pair>  Configuration of a new run by name, such as Browser=Chrome
                                (repeatable, or comma-separated)
                                env: PROBARA_CONFIGURATIONS
  --tag <tag>                   Tag of a new run (repeatable, or comma-separated)
                                env: PROBARA_RUN_TAGS
  --branch <name>               Branch of the run source
                                env: PROBARA_BRANCH
                                default: detected from the CI
  --commit <sha>                Commit of the run source
                                env: PROBARA_COMMIT
                                default: detected from the CI
  --build-url <url>             CI build URL of the run source
                                env: PROBARA_BUILD_URL
                                default: detected from the CI
  --no-source                   Send no run source (branch, commit, build URL)
  --[no-]create-missing-cases   Create a case for a test that matches none
                                env: PROBARA_CREATE_MISSING_CASES
                                default: true
  --suite-ulid <ulid>           Suite that created cases go under
                                env: PROBARA_SUITE_ULID
                                default: the project root
  --[no-]close-run              Close the run after the import
                                env: PROBARA_CLOSE_RUN
                                default: true for a new run, false for an existing one (--run-ulid)
  --[no-]attachments            Upload the files the reports reference
                                env: PROBARA_UPLOAD_ATTACHMENTS
                                default: true
  --attach-output               Also attach each testcase's system-out and system-err as text files
  --dialect <name>              JUnit dialect of every file, instead of detecting it per file
                                values: auto, jest, pytest, playwright, surefire, gotestsum, generic
                                default: auto
  --error-status <status>       Status of a testcase with an <error>
                                values: failed, blocked
                                default: failed
  --status-mapping <from=to>    Send the results of one status with another, such as failed=blocked
                                (repeatable, or comma-separated)
                                env: PROBARA_STATUS_MAPPING
  --status-filter <status>      Send no result with this status, after --status-mapping (repeatable,
                                or comma-separated)
                                env: PROBARA_STATUS_FILTER
  --root-dir <dir>              Directory the file paths of automation keys are relative to
                                default: the current directory
  --fail-on-failed-tests        Exit 3 when a test failed or was blocked
  --dry-run                     Print what would be sent, and send nothing (no token needed)
  --results-file <path>         JSON file the results that were not sent are written to
                                env: PROBARA_RESULTS_FILE
  --timeout <ms>                Timeout of one HTTP attempt, in milliseconds
                                default: 30000
  --max-retries <n>             Retries of a failed request, 0 to 10
                                default: 4
  --chunk-size <n>              Results per report request, 1 to 500
                                default: 500
  --attachment-concurrency <n>  Results whose attachments upload at the same time, 1 to 8
                                default: 2
  --json                        Print a JSON summary on stdout
  --debug                       Log every request
                                env: PROBARA_DEBUG
                                default: false
  -h, --help                    Show this help

Environment:
  PROBARA_API_TOKEN  The API token (required). There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent. The files are still read, so a
                     missing or invalid file exits 2, and --fail-on-failed-tests still exits 3 when
                     a test failed.

Exit codes:
  0  Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.
  1  Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a
     failed close). Read the log before re-running: a re-run creates a new run unless --run-ulid is
     given, and results sent again into the same run are recorded again (each run case keeps the
     last outcome).
  2  Usage, configuration or input error (unknown option, invalid value, not configured, no file
     matched, invalid XML, not a results file). Nothing was sent.
  3  A test failed or was blocked, and --fail-on-failed-tests was given. Codes 1 and 2 win.
```

### What it does

1. Expands every path: a file, a directory (every `*.xml` beneath it) or a glob. Patterns keep
   their order, the files of each pattern are sorted, and a file matched twice is read once. A
   pattern that matches nothing is a warning; when none matches, the command exits 2 with one
   error naming them all. Glob patterns use `/`, even on Windows
   ([no JUnit file matched](troubleshooting.md#no-junit-file-matched)).
2. Parses every file and detects its [dialect](junit.md#dialect-detection). One file that is not
   well-formed XML, or not a JUnit report, stops the command before anything is sent (exit 2).
3. Logs a pre-flight block: each file with its dialect and number of results (the first 10 files;
   `--debug` lists the others), the totals, the project, the run, the base URL, and whether missing
   cases are created and attachments uploaded. The token is never printed.
4. Sends the results in [chunks](network.md#chunks-and-ordering) into one run, uploads the
   [attachments](attachments.md), and closes the run.
5. When reporting failed (exit 1) and the run is still open, the last log line names the run and,
   for a new run, the `--run-ulid` that imports into it
   ([the run was left open](troubleshooting.md#the-run-was-left-open)).

### Examples

Import one report, a folder of Surefire reports, or every XML file under `reports/`:

```bash
probara import junit junit.xml
probara import junit target/surefire-reports
probara import junit "reports/**/*.xml"
```

Several paths and patterns go into the same run:

```bash
probara import junit reports/pytest.xml reports/go.xml
```

Name and tag the new run, and put the cases it creates under a suite:

```bash
probara import junit junit.xml --run-name "Nightly regression" --tag nightly --tag api
probara import junit junit.xml --tag nightly,api --suite-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W4
```

Only link to existing cases, and never create one ([linking](linking.md#turning-case-creation-off)):

```bash
probara import junit junit.xml --no-create-missing-cases
```

Import into a run that already exists. The run stays open, the default for an existing run:

```bash
probara import junit junit.xml --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

Fail the step when a test failed, after the results were sent ([exit codes](exit-codes.md)):

```bash
probara import junit junit.xml --fail-on-failed-tests # exit 3
```

See what would be sent, as JSON, without a token ([debugging](debugging.md#dry-run)):

```bash
probara import junit junit.xml --dry-run --json
```

## `probara import results`

<!-- help: import results -->

```text
Usage: probara import results [options] <file>

Send a results file: the results a reporter or an import could not send.

A reporter or import with --results-file (PROBARA_RESULTS_FILE) writes the results it could not send
to that JSON file, or every result while reporting is off. This sends them, into the runs the file
names (or the run it describes), with its project and settings; flags, then PROBARA_* variables, win
over the file.

Options:
  --project <code>              Project code, such as SHOP
                                env: PROBARA_PROJECT
  --projects <code>             Another project whose cases results may go to, each in its own run
                                (repeatable, or comma-separated)
                                env: PROBARA_PROJECTS
  --base-url <url>              Probara URL
                                env: PROBARA_BASE_URL
                                default: https://app.probara.net
  --run-ulid <ulid>             An existing run: import into it instead of creating one, or close it
                                env: PROBARA_RUN_ULID
  --run-ulids <code=ulid>       An existing run of a project to import into, such as WEB=<ulid>
                                (repeatable, or comma-separated)
                                env: PROBARA_RUN_ULIDS
  --run-name <name>             Name of a new run
                                env: PROBARA_RUN_NAME
                                default: the CI build name, else "Automated run <date> UTC"
  --run-description <text>      Description of a new run
                                env: PROBARA_RUN_DESCRIPTION
  --environment-id <ulid>       Environment of a new run
                                env: PROBARA_ENVIRONMENT_ID
  --environment <name>          Environment of a new run by name
                                env: PROBARA_ENVIRONMENT
  --milestone-id <ulid>         Milestone of a new run
                                env: PROBARA_MILESTONE_ID
  --milestone <ref>             Milestone of a new run by display id (M-3) or name
                                env: PROBARA_MILESTONE
  --plan <ref>                  Test plan of a new run by display id (PLAN-2) or name
                                env: PROBARA_PLAN
  --configuration <ulid>        Configuration of a new run (repeatable, or comma-separated)
                                env: PROBARA_CONFIGURATION_ULIDS
  --configuration-value <pair>  Configuration of a new run by name, such as Browser=Chrome
                                (repeatable, or comma-separated)
                                env: PROBARA_CONFIGURATIONS
  --tag <tag>                   Tag of a new run (repeatable, or comma-separated)
                                env: PROBARA_RUN_TAGS
  --branch <name>               Branch of the run source
                                env: PROBARA_BRANCH
                                default: detected from the CI
  --commit <sha>                Commit of the run source
                                env: PROBARA_COMMIT
                                default: detected from the CI
  --build-url <url>             CI build URL of the run source
                                env: PROBARA_BUILD_URL
                                default: detected from the CI
  --no-source                   Send no run source (branch, commit, build URL)
  --[no-]create-missing-cases   Create a case for a test that matches none
                                env: PROBARA_CREATE_MISSING_CASES
                                default: true
  --suite-ulid <ulid>           Suite that created cases go under
                                env: PROBARA_SUITE_ULID
                                default: the project root
  --[no-]close-run              Close the run after the import
                                env: PROBARA_CLOSE_RUN
                                default: true for a new run, false for an existing one (--run-ulid)
  --[no-]attachments            Upload the files the reports reference
                                env: PROBARA_UPLOAD_ATTACHMENTS
                                default: true
  --status-mapping <from=to>    Send the results of one status with another, such as failed=blocked
                                (repeatable, or comma-separated)
                                env: PROBARA_STATUS_MAPPING
  --status-filter <status>      Send no result with this status, after --status-mapping (repeatable,
                                or comma-separated)
                                env: PROBARA_STATUS_FILTER
  --root-dir <dir>              Directory the file paths of automation keys are relative to; the
                                results file's own comes first
                                default: the current directory
  --dry-run                     Print what would be sent, and send nothing (no token needed)
  --results-file <path>         JSON file the results that were not sent are written to
                                env: PROBARA_RESULTS_FILE
  --timeout <ms>                Timeout of one HTTP attempt, in milliseconds
                                default: 30000
  --max-retries <n>             Retries of a failed request, 0 to 10
                                default: 4
  --chunk-size <n>              Results per report request, 1 to 500
                                default: 500
  --attachment-concurrency <n>  Results whose attachments upload at the same time, 1 to 8
                                default: 2
  --json                        Print a JSON summary on stdout
  --debug                       Log every request
                                env: PROBARA_DEBUG
                                default: false
  -h, --help                    Show this help

Environment:
  PROBARA_API_TOKEN  The API token (required). There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.
  1  Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a
     failed close). Read the log before re-running: results sent again into the same run are
     recorded again (each run case keeps the last outcome); --results-file keeps what was not sent.
  2  Usage, configuration or input error (unknown option, invalid value, not configured, no file
     matched, invalid XML, not a results file). Nothing was sent.
```

### What it does

A reporter (such as [`@probara/playwright-reporter`](https://github.com/cynch-me/probara-sdk/blob/main/packages/playwright-reporter/README.md))
or `import junit` with `--results-file` (`PROBARA_RESULTS_FILE`) writes the results it could not
send to that JSON file: those of a failed report and every report after it, when Probara was
down, the network was lost or a project refused. With reporting off (`PROBARA_ENABLED=false`), it
writes every result; a reporter does too without a token, while `import junit` without a token is
an error (exit 2) and writes nothing. The file is only written when there is something in it.

1. Reads the file (version 1): its project, `--projects`, runs and settings, and its results.
   A file that cannot be read, is not JSON or is not a results file stops the command (exit 2).
2. Takes the flags first, then the `PROBARA_*` variables, then the file: `--run-ulid` or
   `PROBARA_RUN_ULID` sends into another run than the one the file names.
3. Logs the same pre-flight block as `import junit`, and sends the results into the runs the file
   names (the results go back into the run their report left open) or into the run it describes.
   Each run is closed like the first import would have: a run it created is closed, a run it
   reused stays open, unless `--close-run`, `--no-close-run` or `PROBARA_CLOSE_RUN` says otherwise
   for every run.
4. With `--results-file`, what could not be sent this time is written there, the same file
   included; when every result was sent, the results file at that path is deleted, so it is not
   sent twice.

Attachments are referenced by absolute path: keep the files (Playwright's output folder, the
`<name>-attachments/` folder next to the file) until the file is sent.

### Examples

Keep what could not be sent:

```bash
probara import junit junit.xml --results-file probara-results.json
```

Send it later, when the file exists: it is only written when something could not be sent.

```bash
probara import results probara-results.json
```

See what would be sent, without a token:

```bash
probara import results probara-results.json --dry-run
```

<!-- output: import -->

```text
$ probara import results probara-results.json
[probara] probara-results.json: 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Recorded 10 results (10 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## `probara run create`

<!-- help: run create -->

```text
Usage: probara run create [options]

Create a run for sharded CI and print its ULID.

Create the run once, before the shards: pass its ULID to every shard as PROBARA_RUN_ULID, and close
it with probara run close once every shard reported. On success stdout holds the ULID alone. Assign
it first, then export it: an export with the command inside exits 0 even when the creation failed.

Example:
  PROBARA_RUN_ULID=$(probara run create --run-name "Nightly")
  export PROBARA_RUN_ULID

Options:
  --project <code>              Project code, such as SHOP
                                env: PROBARA_PROJECT
  --base-url <url>              Probara URL
                                env: PROBARA_BASE_URL
                                default: https://app.probara.net
  --run-name <name>             Name of a new run
                                env: PROBARA_RUN_NAME
                                default: the CI build name, else "Automated run <date> UTC"
  --run-description <text>      Description of a new run
                                env: PROBARA_RUN_DESCRIPTION
  --environment-id <ulid>       Environment of a new run
                                env: PROBARA_ENVIRONMENT_ID
  --environment <name>          Environment of a new run by name
                                env: PROBARA_ENVIRONMENT
  --milestone-id <ulid>         Milestone of a new run
                                env: PROBARA_MILESTONE_ID
  --milestone <ref>             Milestone of a new run by display id (M-3) or name
                                env: PROBARA_MILESTONE
  --plan <ref>                  Test plan of a new run by display id (PLAN-2) or name
                                env: PROBARA_PLAN
  --configuration <ulid>        Configuration of a new run (repeatable, or comma-separated)
                                env: PROBARA_CONFIGURATION_ULIDS
  --configuration-value <pair>  Configuration of a new run by name, such as Browser=Chrome
                                (repeatable, or comma-separated)
                                env: PROBARA_CONFIGURATIONS
  --tag <tag>                   Tag of a new run (repeatable, or comma-separated)
                                env: PROBARA_RUN_TAGS
  --branch <name>               Branch of the run source
                                env: PROBARA_BRANCH
                                default: detected from the CI
  --commit <sha>                Commit of the run source
                                env: PROBARA_COMMIT
                                default: detected from the CI
  --build-url <url>             CI build URL of the run source
                                env: PROBARA_BUILD_URL
                                default: detected from the CI
  --no-source                   Send no run source (branch, commit, build URL)
  --timeout <ms>                Timeout of one HTTP attempt, in milliseconds
                                default: 30000
  --max-retries <n>             Retries of a failed request, 0 to 10
                                default: 4
  --json                        Print a JSON summary on stdout
  --debug                       Log every request
                                env: PROBARA_DEBUG
                                default: false
  -h, --help                    Show this help

Environment:
  PROBARA_API_TOKEN  The API token (required). There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.
  1  Reporting to Probara failed (the create or the close failed). Read the log before re-running: a
     failed create may have created a run.
  2  Usage, configuration or input error (unknown option, invalid value, not configured, no file
     matched, invalid XML, not a results file). Nothing was sent.
```

On success, stdout holds the ULID and nothing else, so a shell can capture it. Assign it on its own
line, then export it. `export PROBARA_RUN_ULID=$(...)` would hide a failed creation, because the
exit status of `export` is 0 whatever the command inside returned.

```bash
PROBARA_RUN_ULID=$(probara run create --run-name "Nightly")
export PROBARA_RUN_ULID
probara import junit shards/shard-1/junit.xml
probara import junit shards/shard-2/junit.xml
probara run close
```

<!-- output: stdout -->

```text
$ probara run create --run-name "Nightly"
01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

- The run is an empty **automated** run: it is created without cases (`automated: true`), and each
  import adds the cases it reports. A manual run created in the Probara app still needs its cases.
  It needs a Probara version that accepts automated runs; an older one answers 422
  `validation_failed` (exit 1).
- The run gets the name, tags, environment, milestone, configurations and CI source that a run
  created by `import junit` would get.
- `run create` refuses to run when `PROBARA_RUN_ULID` is already set (exit 2): the job already has
  a run, and a second one is almost certainly a mistake.
- With `--json`, stdout holds `{ "status": "created", "run": { ... } }` instead of the bare ULID.
- With `PROBARA_ENABLED=false`, nothing is created, stdout is empty and the exit code is 0 (a
  usage error still exits 2).
- When the creation failed after the request may have reached Probara (a network error, a timeout
  or a 5xx), the log says so and links the project's runs: check them before you create another.

## `probara run close`

<!-- help: run close -->

```text
Usage: probara run close [options]

Close a run once every shard reported into it.

A run that is already closed (or aborted) counts as closed: the exit code is 0.

Options:
  --project <code>   Project code, such as SHOP
                     env: PROBARA_PROJECT
  --base-url <url>   Probara URL
                     env: PROBARA_BASE_URL
                     default: https://app.probara.net
  --run-ulid <ulid>  An existing run: import into it instead of creating one, or close it
                     env: PROBARA_RUN_ULID
  --timeout <ms>     Timeout of one HTTP attempt, in milliseconds
                     default: 30000
  --max-retries <n>  Retries of a failed request, 0 to 10
                     default: 4
  --json             Print a JSON summary on stdout
  --debug            Log every request
                     env: PROBARA_DEBUG
                     default: false
  -h, --help         Show this help

Environment:
  PROBARA_API_TOKEN  The API token (required). There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.
  1  Reporting to Probara failed (the create or the close failed). Read the log before re-running: a
     failed create may have created a run.
  2  Usage, configuration or input error (unknown option, invalid value, not configured, no file
     matched, invalid XML, not a results file). Nothing was sent.
```

```bash
probara run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 probara run close --json
```

<!-- output: stdout -->

```text
$ probara run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3 --json
{
  "status": "closed",
  "run": {
    "ulid": "01J9Z3K4M5N6P7Q8R9S0T1V2W3",
    "displayId": "R-1",
    "state": "closed",
    "url": "https://app.probara.net/projects/SHOP/runs/R-1"
  }
}
```

- The project is required too: it builds the link to the run in the log.
- A run that is already closed or aborted is not an error: the command logs it and exits 0, and
  `--json` prints `"status": "already_closed"`.
- A close that failed after the retries exits 1. The run stays open until you run the command
  again or close it in Probara.

## See also

- [Configuration](configuration.md): every option, its variable and its default.
- [Sharded runs](ci/sharding.md): `run create`, the shards, then `run close`.
- [Exit codes](exit-codes.md).
