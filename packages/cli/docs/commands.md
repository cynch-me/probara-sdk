# Commands

`probara` has twelve commands. Each one reads its options from flags and `PROBARA_*` variables
([configuration](configuration.md)), logs on stderr and keeps stdout for machine output
([debugging](debugging.md)).

| Command                                               | Use it to                                            |
| ----------------------------------------------------- | ---------------------------------------------------- |
| [`probara import junit`](#probara-import-junit)       | Import JUnit XML files into one run                  |
| [`probara import results`](#probara-import-results)   | Send results files: what a reporter could not send   |
| [`probara import cucumber`](#probara-import-cucumber) | Import Cucumber JSON reports as scenario results     |
| [`probara run create`](#probara-run-create)           | Create a run up front, for shards that share it      |
| [`probara run close`](#probara-run-close)             | Close a shared run once every shard reported into it |
| [`probara sync gherkin`](#probara-sync-gherkin)       | Sync the scenarios of `.feature` files to Probara    |
| [`probara vis list`](#probara-vis-list)               | List the organization's Vises                        |
| [`probara vis get`](#probara-vis-get)                 | Show one Vis                                         |
| [`probara vis create`](#probara-vis-create)           | Upload a recording or a screenshot as a new Vis      |
| [`probara vis update`](#probara-vis-update)           | Rename, describe, move or hide a Vis                 |
| [`probara vis delete`](#probara-vis-delete)           | Delete a Vis                                         |
| [`probara vis record`](#probara-vis-record)           | Record a page of a browser an agent drives           |

The help below is the real output of each `--help`: the docs tests check it byte for byte.

## `probara`

<!-- help: probara -->

```text
Usage: probara <command> [options]

Report automated test results to Probara from any CI, and manage Probara Vises.

Commands:
  import junit <paths...>      Import JUnit XML files into one Probara run
  import results <paths...>    Send results files: the results a reporter or an import could not
                               send
  import cucumber <paths...>   Import Cucumber JSON reports as the results of their scenarios
  run create                   Create a run for sharded CI and print its ULID
  run close                    Close a run once every shard reported into it
  sync gherkin <globs...>      Sync the Gherkin scenarios of .feature files with the synced cases of
                               a project
  vis list                     List the organization's Vises, newest first
  vis get <id>                 Show one Vis
  vis create <file>            Upload a recording or a screenshot as a new Vis
  vis update <id>              Change the title, description, folder or visibility of a Vis
  vis delete <id>              Delete a Vis and all its media
  vis record --cdp <endpoint>  Record a page of a browser over the Chrome DevTools Protocol as a
                               replay Vis

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
  junit <paths...>     Import JUnit XML files into one Probara run
  results <paths...>   Send results files: the results a reporter or an import could not send
  cucumber <paths...>  Import Cucumber JSON reports as the results of their scenarios

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

`probara sync --help` lists the sync commands (there is one so far):

<!-- help: sync -->

```text
Usage: probara sync <command> [options]

Commands:
  gherkin <globs...>  Sync the Gherkin scenarios of .feature files with the synced cases of a
                      project

Run "probara sync <command> --help" for its options.
```

`probara vis --help` lists the commands of Probara Vis:

<!-- help: vis -->

```text
Usage: probara vis <command> [options]

Commands:
  list                     List the organization's Vises, newest first
  get <id>                 Show one Vis
  create <file>            Upload a recording or a screenshot as a new Vis
  update <id>              Change the title, description, folder or visibility of a Vis
  delete <id>              Delete a Vis and all its media
  record --cdp <endpoint>  Record a page of a browser over the Chrome DevTools Protocol as a replay
                           Vis

Run "probara vis <command> --help" for its options.
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
                                values: auto, jest, pytest, playwright, surefire, gotestsum,
                                cypress-junit, vitest, generic
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
  --assign-failed-to <email>    Assign failed results without an assignee to this member, in turn
                                (repeatable, or comma-separated)
                                env: PROBARA_ASSIGN_FAILED_TO
  --root-dir <dir>              Directory the file paths of automation keys are relative to
                                default: the current directory
  --fail-on-failed-tests        Exit 3 for a failed or blocked test, or an unhandled error left out
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
                     a test failed or an unhandled error was left out.

Exit codes:
  0  Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.
  1  Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a
     failed close). Read the log before re-running: a re-run creates a new run unless --run-ulid is
     given, and results sent again into the same run are recorded again (each run case keeps the
     last outcome).
  2  Usage, configuration or input error (unknown option, invalid value, not configured, no file
     matched, invalid XML). Nothing was sent.
  3  A test failed or was blocked, or an unhandled error was left out (Vitest 5), and
     --fail-on-failed-tests was given. Codes 1 and 2 win.
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

Fail the step when a test failed or an unhandled error was left out, after the results were
sent ([exit codes](exit-codes.md)):

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
Usage: probara import results [options] <paths...>

Send results files: the results a reporter or an import could not send.

A reporter or import with --results-file (PROBARA_RESULTS_FILE) writes the results it could not send
to that JSON file, or every result while reporting is off; when a file is already there, it writes
the first free sibling (probara-results-2.json, ...). This sends them, into the runs each file names
(or the run it describes), with its project and settings; flags, then PROBARA_* variables, win over
each file.

Each path is a file or a glob, relative to the current directory: quote globs so the shell leaves
them to probara, as in probara import results 'probara-results*.json'. Every file is read and
checked before anything is sent: one that cannot be imported sends nothing. When no file matches,
nothing was left unsent: the exit code is 0.

Each file is consumed on its own: once every result in it was sent, it is deleted with its
<name>-attachments folder; otherwise it is rewritten with only the results still unsent, so running
this again never sends a result twice. An attachment whose upload failed is gone with it: the file
no longer holds its result. --dry-run and PROBARA_ENABLED=false leave every file as it is.

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
  --assign-failed-to <email>    Assign failed results without an assignee to this member, in turn
                                (repeatable, or comma-separated)
                                env: PROBARA_ASSIGN_FAILED_TO
  --root-dir <dir>              Directory the file paths of automation keys are relative to; the
                                results file's own comes first
                                default: the current directory
  --dry-run                     Print what would be sent, and send nothing (no token needed)
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
  0  Done (reported); or no results file matched (nothing was left unsent); or disabled by
     PROBARA_ENABLED=false; or a dry run.
  1  Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a
     failed close). Read the log before re-running: results sent again into the same run are
     recorded again (each run case keeps the last outcome); a results file keeps what was not sent
     (--results-file, or the file import results sends).
  2  Usage, configuration or input error (unknown option, invalid value, not configured, a
     directory, a file that cannot be read or is not a results file). Nothing was sent: every file
     is checked first.
```

### What it does

A reporter (such as [`@probara/playwright-reporter`](https://github.com/cynch-me/probara-sdk/blob/main/packages/playwright-reporter/README.md))
or `import junit` with `--results-file` (`PROBARA_RESULTS_FILE`) writes the results it could not
send to that JSON file: those of a failed report and every report after it, when Probara was
down, the network was lost or a project refused. With reporting off (`PROBARA_ENABLED=false`), it
writes every result; a reporter does too without a token, while `import junit` without a token is
an error (exit 2) and writes nothing. The file is only written when there is something in it, and
a file already at that path is never touched: the writer takes the first free sibling
(`probara-results-2.json`, `probara-results-3.json`, ...) and logs its path.

1. Expands each path: a file, or a glob (quote it). A directory is refused (exit 2): not every
   JSON file in it is a results file. Files come in the order they were written:
   `probara-results.json`, then `probara-results-2.json`, and so on.
2. When no file matches, logs `No results file matched ...: nothing was left unsent` and exits 0:
   the reporters sent everything. The flags and variables are still checked (exit 2 when wrong).
3. Reads every file (version 1): its project, `--projects`, runs and settings, and its results.
   A file that cannot be read, is not JSON or is not a results file, or whose settings are wrong,
   stops the command before anything is sent (exit 2). An empty file a glob matches is skipped
   with a warning and left where it is: it holds no result (reporters never leave one, but an
   earlier version could when it stopped halfway). Named on its own, it stops the command too.
   A results file is trusted input: its attachments are uploaded from the paths it names, so
   import only the files your own jobs wrote. An attachment whose relative path leads outside the
   folder of the file (`../secret.txt`) is left out with a warning; absolute paths are kept.
4. Sends each file on its own, taking the flags first, then the `PROBARA_*` variables, then the
   file: `--run-ulid` or `PROBARA_RUN_ULID` sends into another run than the one the file names.
   It logs the same pre-flight block as `import junit` for each file, and sends its results into
   the runs the file names (the results go back into the run their report left open) or into the
   run it describes. Each run is closed like the first import would have: a run it created is
   closed, a run it reused stays open, unless `--close-run`, `--no-close-run` or
   `PROBARA_CLOSE_RUN` says otherwise for every run.
5. Consumes each file: once every result in it was sent, it deletes the file and its
   `<name>-attachments/` folder; otherwise it rewrites the file with only the results still
   unsent, naming the runs they go back into (written to a temporary file, then renamed over it).
   A file that fails does not stop the next ones; the command exits 1 when any file failed.
   Running it again never sends a result twice, so a CI step can import whatever is there.
   `--dry-run` and `PROBARA_ENABLED=false` leave every file as it is, and `PROBARA_RESULTS_FILE`
   does not apply: it names the file reporters write.

The files a reporter stored next to the file, in its `<name>-attachments/` folder, are referenced
relative to the file: move or download the file and its folder together, anywhere, and import it
from there. Any other file (Playwright's output folder) is referenced by its absolute path: keep it
there until the file is sent. An upload that fails once
its result was recorded is not kept for later: the result is no longer in the file, and the folder
goes with the file once every result was sent. The log and `summary.attachmentErrors` name it.

With `--json`, stdout holds `{ exitCode, files: [{ path, results, status, tests, summary }] }`, one
entry per file sent (`files` is empty when no file matched), and with `--dry-run`
`{ dryRun: true, exitCode, files: [{ path, results, tests, invalid, entries, filtered, dropped }] }`.

### Examples

Keep what could not be sent:

```bash
probara import junit junit.xml --results-file probara-results.json
```

Send it later, with every sibling a later run wrote: nothing matching exits 0, and each file is
deleted once everything in it was sent.

```bash
probara import results 'probara-results*.json'
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
[probara] Deleted probara-results.json: every result was sent
```

## `probara import cucumber`

<!-- help: import cucumber -->

```text
Usage: probara import cucumber [options] <paths...>

Import Cucumber JSON reports as the results of their scenarios.

Reads the Cucumber JSON that cucumber-js (--format json), Cucumber-JVM, Reqnroll and playwright-bdd
write. Each path is a file, a directory (every *.json beneath it) or a glob, relative to the current
directory. Every file is read and checked before anything is sent: one invalid file sends nothing.

A scenario is keyed the way probara sync gherkin keys it: its feature file, read under --root-dir,
gives its Feature and Scenario names, and each row of a Scenario Outline is a result with the
Examples values as its parameters. A feature file that is not there keys the scenarios by the names
in the report.

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
  --status-mapping <from=to>    Send the results of one status with another, such as failed=blocked
                                (repeatable, or comma-separated)
                                env: PROBARA_STATUS_MAPPING
  --status-filter <status>      Send no result with this status, after --status-mapping (repeatable,
                                or comma-separated)
                                env: PROBARA_STATUS_FILTER
  --assign-failed-to <email>    Assign failed results without an assignee to this member, in turn
                                (repeatable, or comma-separated)
                                env: PROBARA_ASSIGN_FAILED_TO
  --root-dir <dir>              Directory the file paths of automation keys are relative to
                                default: the current directory
  --fail-on-failed-tests        Exit 3 for a failed or blocked test, or an unhandled error left out
  --dry-run                     Print what would be sent, and send nothing (no token needed)
  --timeout <ms>                Timeout of one HTTP attempt, in milliseconds
                                default: 30000
  --max-retries <n>             Retries of a failed request, 0 to 10
                                default: 4
  --chunk-size <n>              Results per report request, 1 to 500
                                default: 500
  --json                        Print a JSON summary on stdout
  --debug                       Log every request
                                env: PROBARA_DEBUG
                                default: false
  -h, --help                    Show this help

Environment:
  PROBARA_API_TOKEN  The API token (required). There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent. The files are still read, so a
                     missing or invalid file exits 2, and --fail-on-failed-tests still exits 3 when
                     a test failed or an unhandled error was left out.

Exit codes:
  0  Done (reported, created or closed); or disabled by PROBARA_ENABLED=false; or a dry run.
  1  Reporting to Probara failed (a failed or partial report, invalid results, failed uploads, a
     failed close). Read the log before re-running: a re-run creates a new run unless --run-ulid is
     given, and results sent again into the same run are recorded again (each run case keeps the
     last outcome).
  2  Usage, configuration or input error (unknown option, invalid value, not configured, no file
     matched, a file that is not valid Cucumber JSON, a feature file that does not parse). Nothing
     was sent.
  3  A test failed or was blocked, or an unhandled error was left out (Vitest 5), and
     --fail-on-failed-tests was given. Codes 1 and 2 win.
```

### What it does

1. Expands every path: a file, a directory (every `*.json` beneath it) or a glob. One file that is
   not a Cucumber JSON report (an array of features) stops the command before anything is sent
   (exit 2).
2. Reads each feature file the report names, under `--root-dir`, with the Gherkin parser. A file
   that does not parse stops the command before anything is sent (exit 2). A file that is not there
   is noted once, and its scenarios are keyed by the names in the report.
3. Makes one result of each scenario, and one of each row of a Scenario Outline, keyed as
   [`probara sync gherkin`](gherkin.md#keys) keys it. Each step becomes a result step with its
   keyword, status, duration and data; the Background steps sit under one `Background` step. The
   status mapping is in [Cucumber results](gherkin.md#cucumber-results). Attachments in the report
   (`embeddings`) are not sent.
4. Sends the results as `import junit` does: one run, [in chunks](network.md#chunks-and-ordering),
   with the same run, project, dry-run and JSON options.

### Examples

For results with their attachments, sent at the end of the run, run cucumber-js with [`@probara/cucumber-reporter`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cucumber-reporter/README.md) instead of the JSON formatter and the import below.

Run cucumber-js with its JSON formatter, then import the report:

```bash
npx cucumber-js --format json:results/cucumber.json
probara import cucumber results/cucumber.json
```

Name the new run, and tag it:

```bash
probara import cucumber results/cucumber.json --run-name "Checkout BDD" --tag bdd
```

Fail the step when a scenario failed, after the results were sent ([exit codes](exit-codes.md)):

```bash
probara import cucumber results/cucumber.json --fail-on-failed-tests # exit 3
```

See what would be sent, as JSON, without a token ([debugging](debugging.md#dry-run)):

```bash
probara import cucumber results/cucumber.json --dry-run --json
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
     matched, invalid XML). Nothing was sent.
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

Closes the run of --run-ulid (PROBARA_RUN_ULID). Without one, in GitHub Actions, it closes the run
the jobs of its workflow run reported into: run it in a final job, with needs on every test job and
if: always().

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
     matched, invalid XML). Nothing was sent.
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
- In GitHub Actions, without a run ULID, the command sends Probara a report of no results that
  closes the run of the workflow run (its repository, run id and attempt): the run every job
  reported into without a ULID ([GitHub Actions](ci/github-actions.md#parallel-jobs-one-run-closed-by-the-final-job)).
  Elsewhere, a missing run is a configuration error (exit 2).
- A run that is already closed or aborted is not an error: the command logs it and exits 0, and
  `--json` prints `"status": "already_closed"`.
- A close that failed after the retries exits 1. The run stays open until you run the command
  again or close it in Probara.

## `probara sync gherkin`

<!-- help: sync gherkin -->

```text
Usage: probara sync gherkin [options] <globs...>

Sync the Gherkin scenarios of .feature files with the synced cases of a project.

Each argument is a file, a directory (every .feature file beneath it) or a glob, relative to the
current directory: quote globs so the shell leaves them to probara. Every file is parsed with the
Gherkin parser before anything is sent: one that does not parse sends nothing. Paths are relative to
--root-dir, which should be the repository root so the file links open.

Each scenario is keyed <path> > <Feature> > <Scenario>. A synced case whose scenario is gone is
archived, never deleted, and only when its file matches one of the arguments: the cases of other
folders are left alone, so each folder can be synced by its own job. A scenario tagged @probara:<ID>
is bound to that case, and a case whose content did not change keeps its history when the scenario
moves.

Example:
  probara sync gherkin "features/**/*.feature" --dry-run

Options:
  --project <code>     Project code, such as SHOP
                       env: PROBARA_PROJECT
  --base-url <url>     Probara URL
                       env: PROBARA_BASE_URL
                       default: https://app.probara.net
  --suite-ulid <ulid>  Suite that created cases go under
                       env: PROBARA_SUITE_ULID
                       default: the project root
  --root-dir <dir>     Directory the file paths of automation keys are relative to; the repository
                       root, so the file links open
                       default: the current directory
  --file-url <url>     Link of each scenario: {path} and {line} are filled in, such as
                       https://git.example.com/repo/blob/main/{path}#L{line}; only https links are
                       sent
                       default: the CI link of the file and line, when the CI is known
  --dry-run            Show what the sync would do, and write nothing; Probara computes the outcome,
                       so it needs the token and the project
  --timeout <ms>       Timeout of one HTTP attempt, in milliseconds
                       default: 30000
  --max-retries <n>    Retries of a failed request, 0 to 10
                       default: 4
  --json               Print a JSON summary on stdout
  --debug              Log every request
                       env: PROBARA_DEBUG
                       default: false
  -h, --help           Show this help

Environment:
  PROBARA_API_TOKEN  The API token (required). There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done: the scenarios were synced (with --dry-run, the outcome was computed and nothing was
     written); or disabled by PROBARA_ENABLED=false.
  1  Probara refused the sync, or could not be reached after the retries. A sync that Probara
     refuses writes nothing: fix the cause and run it again.
  2  Usage, configuration or input error (unknown option, invalid value, not configured, no file
     matched, a file that does not parse or is outside --root-dir, a step keyword that is not
     English, two scenarios with one automation key, more than 1,000 scenarios or 20 globs). Nothing
     was sent.
```

### What it does

1. Expands each argument as `import junit` does: a file, a directory (every `.feature` file beneath
   it) or a glob. When nothing matches, the command exits 2, so a typo never archives a folder.
2. Parses every file with the official Gherkin parser. A syntax error, a step keyword that is not
   English, a Feature or a scenario without a name, or a file outside `--root-dir` stops the command
   before anything is sent (exit 2), each named by `path:line`.
3. Keys every scenario `<path> > <Feature> > <Scenario>`. Two scenarios with one key stop the
   command, and both lines are named.
4. Sends the features, their scenarios and the scope of the arguments to Probara, which answers what
   each case became: created, updated, moved, restored, archived or unchanged. The summary counts
   them, and each created, updated, moved, restored or archived case has a line.
5. Probara changes the synced cases under the scope only. [Scope, moves and archives](gherkin.md#scope-and-archiving)
   say which cases a sync may touch.

### Examples

Sync every feature file, from the repository root (the default `--root-dir`):

```bash
probara sync gherkin "features/**/*.feature"
```

<!-- output: sync -->

```text
$ probara sync gherkin "features/**/*.feature"
[probara] Files: 2 feature files, 9 scenarios
[probara] Project: SHOP
[probara] Base URL: https://app.probara.net
[probara] Created 9, updated 0, moved 0, restored 0, archived 0, unchanged 0
[probara] created  SHOP-1  features/cart/cart.feature > Cart > Add a book
[probara] created  SHOP-2  features/checkout/pay.feature > Checkout > Pay with the saved card
[probara] created  SHOP-3  features/checkout/pay.feature > Checkout > Pay with <method>
[probara] created  SHOP-4  features/checkout/pay.feature > Checkout > Send the receipt
[probara] created  SHOP-5  features/checkout/pay.feature > Checkout > Refund a paid order
[probara] created  SHOP-6  features/checkout/pay.feature > Checkout > A declined card fails
[probara] created  SHOP-7  features/checkout/pay.feature > Checkout > A page with no step definition
[probara] created  SHOP-8  features/checkout/pay.feature > Checkout > A step that is still pending
[probara] created  SHOP-9  features/checkout/pay.feature > Checkout > A step that matches two definitions
```

One folder is one job's scope: sync it on its own, after a dry run that shows what would change:

```bash
probara sync gherkin "features/checkout/**/*.feature" --dry-run
probara sync gherkin "features/checkout/**/*.feature"
```

Link each scenario to a file template, when the CI is not one the CLI knows
([links](gherkin.md#links-to-the-files)):

```bash
probara sync gherkin "features/**/*.feature" --file-url "https://git.example.com/acme/shop/blob/main/{path}#L{line}"
```

See what the sync would send, as JSON ([debugging](debugging.md#dry-run)):

```bash
probara sync gherkin "features/**/*.feature" --dry-run --json
```

## Probara Vis

A Vis is a capture of a bug: a video or a screenshot, with the console, network and user actions
of the page when they were recorded. It belongs to the organization, not to a project, and is shown
as `VIS-<n>`. The `vis` commands need a **personal API token** in `PROBARA_API_TOKEN`
([API tokens](https://docs.probara.net/en/developers/authentication/)): an app token can only
report results, and Probara answers `403 forbidden` to it here. They need Probara Vis on the plan
of the organization (Pro and Enterprise); without it every command exits 1 with `403 forbidden`.
Each command takes the ULID of a Vis or its display ID, such as `VIS-12`.

## `probara vis list`

<!-- help: vis list -->

```text
Usage: probara vis list [options]

List the organization's Vises, newest first.

Prints one line per Vis: its display ID, kind, status, creation date and title. Only the Vises you
can see are listed, and only ready ones unless --status says otherwise. The log line after the list
says which page this is and how many Vises match: pass --page for the next one.

Example:
  probara vis list --kind video --search checkout

Options:
  --base-url <url>   Probara URL
                     env: PROBARA_BASE_URL
                     default: https://app.probara.net
  --kind <kind>      Only the Vises of this kind
                     values: video, screenshot, replay
  --from <source>    Only the Vises made from this source
                     values: extension, recording_link, sdk, upload, cli
  --creator <ulid>   Only the Vises this member (user ULID) created
  --status <status>  Only the Vises in this status; pending lists only your own
                     values: pending, ready, failed
                     default: ready
  --search <text>    Only the Vises whose title contains this text, ignoring case
  --page <n>         Page to list, from 1
                     default: 1
  --page-size <n>    Vises per page, 1 to 200
                     default: 50
  --folder <ulid>    Only the Vises in this folder (its ULID), or none for the Vises in no folder
  --timeout <ms>     Timeout of one HTTP attempt, in milliseconds
                     default: 30000
  --max-retries <n>  Retries of a failed request, 0 to 10
                     default: 4
  --json             Print the page of Vises as JSON on stdout
  --debug            Log every request
                     env: PROBARA_DEBUG
                     default: false
  -h, --help         Show this help

Environment:
  PROBARA_API_TOKEN  A personal API token (required): app tokens (probara_app_...) can only report
                     results. There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done; or disabled by PROBARA_ENABLED=false: nothing was sent.
  1  Probara refused the request (the log says why, such as 404 for a Vis you cannot see), or could
     not be reached after the retries.
  2  Usage or configuration error (unknown option, invalid value, an id that is not a ULID or a
     VIS-<n> display ID, not configured). Nothing was sent.
```

```bash
probara vis list --kind video --search checkout
```

<!-- output: stdout -->

```text
$ probara vis list
VIS-12  video  ready  2026-09-29  Checkout button does nothing
```

- Without `--status`, only `ready` Vises are listed. `--status pending` lists only your own pending
  Vises: the ones still uploading, or left behind by an upload that failed.
- A Vis in a private folder, or a private Vis you were not granted, is never listed.
- `--json` prints the page as Probara answers it: `items`, `page`, `pageSize` and `total`.

## `probara vis get`

<!-- help: vis get -->

```text
Usage: probara vis get [options] <id>

Show one Vis.

The id is the ULID of the Vis or its display ID, such as VIS-12. A Vis you cannot see is not found
(exit 1).

Example:
  probara vis get VIS-12

Options:
  --base-url <url>   Probara URL
                     env: PROBARA_BASE_URL
                     default: https://app.probara.net
  --timeout <ms>     Timeout of one HTTP attempt, in milliseconds
                     default: 30000
  --max-retries <n>  Retries of a failed request, 0 to 10
                     default: 4
  --json             Print the Vis as JSON on stdout
  --debug            Log every request
                     env: PROBARA_DEBUG
                     default: false
  -h, --help         Show this help

Environment:
  PROBARA_API_TOKEN  A personal API token (required): app tokens (probara_app_...) can only report
                     results. There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done; or disabled by PROBARA_ENABLED=false: nothing was sent.
  1  Probara refused the request (the log says why, such as 404 for a Vis you cannot see), or could
     not be reached after the retries.
  2  Usage or configuration error (unknown option, invalid value, an id that is not a ULID or a
     VIS-<n> display ID, not configured). Nothing was sent.
```

```bash
probara vis get VIS-12
probara vis get VIS-12 --json
```

## `probara vis create`

<!-- help: vis create -->

```text
Usage: probara vis create [options] <file>

Upload a recording or a screenshot as a new Vis.

The file is an MP4 or WebM video, or a PNG, JPEG or WebP screenshot, recognized by its content. A
video is uploaded in parts of 8 MiB, each retried on its own after a transient failure, and needs
its length: it is read from the file, and --duration-ms gives it when the file does not record it (a
WebM file written by a browser often does not). On success stdout holds the ULID, the display ID and
the URL of the Vis, separated by spaces.

With --playwright-trace, the trace archive Playwright recorded with the video is read first: its
console messages, network requests (with their headers and bodies when the trace holds them) and the
actions of the test (clicks, fills, key presses, navigations) are uploaded as the diagnostics of the
Vis, timed from the start of the video. Credentials, cookies, tokens and passwords are redacted
before anything leaves the machine, and typed values are masked. A trace that cannot be read sends
nothing.

The Vis is created pending and finalized once every file arrived. When an upload fails, the pending
Vis is deleted again; if Probara cannot be reached for that either, it deletes the Vis seven days
after its creation.

Example:
  probara vis create test-results/checkout/video.webm \
    --playwright-trace test-results/checkout/trace.zip --title "Checkout fails"

Options:
  --base-url <url>                Probara URL
                                  env: PROBARA_BASE_URL
                                  default: https://app.probara.net
  --title <text>                  Title of the Vis, 1 to 200 characters; the file name when omitted
  --description <markdown>        Description of the Vis, in Markdown
  --folder <ulid>                 Folder of the Vis (its ULID)
  --private                       Create the Vis private: only you, the members and groups you
                                  grant, and owners and admins see it
  --page-url <url>                The http or https URL of the page the recording or screenshot
                                  shows
  --metadata <key=value>          Custom metadata of the Vis, such as build=1.42.0; at most 10 KB in
                                  all (repeatable)
  --duration-ms <ms>              Length of the video in milliseconds; required when the file does
                                  not record its length
                                  default: read from the MP4 or WebM file
  --playwright-trace <trace.zip>  Playwright trace of the video: its console messages, network
                                  requests and actions are uploaded as the diagnostics of the Vis,
                                  redacted
  --timeout <ms>                  Timeout of one HTTP attempt, in milliseconds
                                  default: 30000
  --max-retries <n>               Retries of a failed request, 0 to 10
                                  default: 4
  --json                          Print the created Vis, with its url, as JSON on stdout
  --debug                         Log every request
                                  env: PROBARA_DEBUG
                                  default: false
  -h, --help                      Show this help

Environment:
  PROBARA_API_TOKEN  A personal API token (required): app tokens (probara_app_...) can only report
                     results. There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done; or disabled by PROBARA_ENABLED=false: nothing was sent.
  1  Probara refused the Vis or an upload (the log says why), or could not be reached after the
     retries. The pending Vis was deleted again, unless the log says Probara could not be reached
     for that either: Probara then deletes it seven days after its creation.
  2  Usage, configuration or input error (unknown option, invalid value, not configured, a file that
     cannot be read or is not an MP4, WebM, PNG, JPEG or WebP file, a video whose length the file
     does not record and no --duration-ms, a Playwright trace that cannot be read). Nothing was
     sent.
```

Upload a recording, with its length when the file does not record it, or a screenshot of a page:

```bash
probara vis create recording.webm --duration-ms 42000 --title "Checkout fails"
probara vis create screenshot.png --page-url https://shop.example.com/checkout --metadata build=1.42.0
```

<!-- output: stdout -->

```text
$ probara vis create recording.webm --duration-ms 42000 --title "Checkout fails"
01J9Z3K4M5N6P7Q8R9S0T1V2W3 VIS-13 https://app.probara.net/vis/VIS-13
```

- The file is recognized by its first bytes, not its name: an MP4 or WebM video, or a PNG, JPEG
  or WebP image (at most 10 MiB).
- The length of an MP4 is always in the file; a WebM file records it when the tool that wrote it
  could (Playwright and ffmpeg do, a browser's MediaRecorder does not). Without it, pass
  `--duration-ms`. The plan limits the length of a recording: Probara refuses a longer one when the
  Vis is finalized, and the CLI deletes the pending Vis again (exit 1).
- A video goes in parts of 8 MiB. A part that fails with a network error, a timeout, 429 or 5xx is
  sent again on its own, up to `--max-retries` times; the parts already sent stay.
- `--metadata` takes `key=value`, split at the first `=`: `--metadata note=a,b` is the value `a,b`.
- With `PROBARA_ENABLED=false`, the files are still read and checked (exit 2 when one cannot be
  used), and nothing is sent.

### A Playwright video with its trace

Playwright records the video and the trace of a test into its `test-results` folder (`video: 'on'`
and `trace: 'on'`, or `retain-on-failure`, in `playwright.config`). Upload both:

```bash
probara vis create test-results/checkout/video.webm --playwright-trace test-results/checkout/trace.zip --title "Checkout fails"
```

<!-- output: vis -->

```text
$ probara vis create test-results/checkout/video.webm --playwright-trace test-results/checkout/trace.zip --title "Checkout fails"
[probara] Diagnostics from the trace: 4 console messages, 3 requests, 5 actions
[probara] Created VIS-13: uploading test-results/checkout/video.webm (8 KiB)
[probara] Uploaded VIS-13: https://app.probara.net/vis/VIS-13
01J9Z3K4M5N6P7Q8R9S0T1V2W3 VIS-13 https://app.probara.net/vis/VIS-13
```

What the trace becomes, in the [diagnostics formats](https://docs.probara.net/en/developers/api/vis-media/#diagnostics-formats)
of a Vis, gzip-compressed, each line timed from the start of the video:

| Stream    | From the trace                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| `console` | Every console message of the page, with its level and source, and every uncaught page error with its stack         |
| `network` | Every request the browser made: method, URL, status, headers, timing, and the bodies the trace kept (up to 64 KiB) |
| `events`  | The actions of the test: clicks, fills, key presses and navigations, with the selector of the element              |

- Everything goes through the redaction of [`@probara/vis-capture`](https://github.com/cynch-me/probara-sdk/blob/main/packages/vis-capture/README.md)
  before it is sent: the `Authorization`, `Cookie` and `Set-Cookie` headers, tokens, keys,
  passwords and card numbers in URLs, headers and bodies become `PROBARA_REDACTED`.
- A filled value is masked, one `*` per character, and the value of a field whose selector names a
  password, a token, a PIN or a card is not recorded at all.
- A trace that cannot be read (not a ZIP archive, no `trace.trace` in it, a line that is not JSON,
  a file larger than 128 MiB once decompressed)
  exits 2 and sends nothing, the video included: rerun with the right file, or without
  `--playwright-trace`.

## `probara vis update`

<!-- help: vis update -->

```text
Usage: probara vis update [options] <id>

Change the title, description, folder or visibility of a Vis.

The id is the ULID of the Vis or its display ID, such as VIS-12. Only the options given change.
Changing a Vis takes being its creator, or an owner or admin of the organization.

Example:
  probara vis update VIS-12 --title "Checkout fails on Safari" --visibility private

Options:
  --base-url <url>          Probara URL
                            env: PROBARA_BASE_URL
                            default: https://app.probara.net
  --title <text>            Title of the Vis, 1 to 200 characters
  --description <markdown>  Description of the Vis, in Markdown; an empty one clears it
  --folder <ulid>           Move the Vis to this folder (its ULID), or none to take it out of its
                            folder
  --visibility <mode>       public: every member of the organization sees the Vis; private: only
                            you, the members and groups granted it, and owners and admins
                            values: public, private
  --timeout <ms>            Timeout of one HTTP attempt, in milliseconds
                            default: 30000
  --max-retries <n>         Retries of a failed request, 0 to 10
                            default: 4
  --json                    Print the updated Vis as JSON on stdout
  --debug                   Log every request
                            env: PROBARA_DEBUG
                            default: false
  -h, --help                Show this help

Environment:
  PROBARA_API_TOKEN  A personal API token (required): app tokens (probara_app_...) can only report
                     results. There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done; or disabled by PROBARA_ENABLED=false: nothing was sent.
  1  Probara refused the request (the log says why, such as 404 for a Vis you cannot see), or could
     not be reached after the retries.
  2  Usage or configuration error (unknown option, invalid value, an id that is not a ULID or a
     VIS-<n> display ID, not configured). Nothing was sent.
```

```bash
probara vis update VIS-12 --title "Checkout fails on Safari" --visibility private
probara vis update VIS-12 --folder none
```

- `--folder none` takes the Vis out of its folder; `--description ""` clears the description.
- Making a Vis private also stops its link sharing: a link shared with anyone stops working.

## `probara vis delete`

<!-- help: vis delete -->

```text
Usage: probara vis delete [options] <id>

Delete a Vis and all its media.

The id is the ULID of the Vis or its display ID, such as VIS-12. The command shows the Vis and asks
for a confirmation on the terminal; --yes deletes without asking, and is required when stdin is not
a terminal (in CI). A deleted Vis cannot be restored.

Example:
  probara vis delete VIS-12 --yes

Options:
  --base-url <url>   Probara URL
                     env: PROBARA_BASE_URL
                     default: https://app.probara.net
  --yes              Delete without asking for a confirmation (required when stdin is not a
                     terminal)
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
  PROBARA_API_TOKEN  A personal API token (required): app tokens (probara_app_...) can only report
                     results. There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done; or disabled by PROBARA_ENABLED=false: nothing was sent.
  1  Probara refused the deletion or could not be reached after the retries, or the deletion was not
     confirmed. Nothing was deleted.
  2  Usage or configuration error (unknown option, an id that is not a ULID or a VIS-<n> display ID,
     not configured, no --yes when stdin is not a terminal). Nothing was deleted.
```

```bash
probara vis delete VIS-12 --yes
```

On a terminal, the command shows the Vis and waits for `y`:

```text
Delete VIS-12 "Checkout button does nothing" and all its media? It cannot be restored. [y/N]
```

Any other answer keeps the Vis (exit 1). In CI, stdin is not a terminal: without `--yes` the
command deletes nothing and exits 2.

## `probara vis record`

<!-- help: vis record -->

```text
Usage: probara vis record [options] --cdp <endpoint>

Record a page of a browser over the Chrome DevTools Protocol as a replay Vis.

Attaches to a Chromium browser that has a debugging port (started with --remote-debugging-port, or
driven by Playwright, Puppeteer or an agent) and records one page: the one --target names, or the
only one. The capture script of @probara/vis-capture is injected into the page and into every
document it navigates to. It records the page as a DOM replay, with the console, the network
requests and the user actions, each timed from the start of the replay. Typed text is masked,
password fields are never recorded, and elements marked data-probara-blur are left out. The browser
receives the capture script and nothing else.

The recording stops on Ctrl+C or SIGTERM, after --duration, when the page closes, or at 60 minutes.
Then the Vis is created and uploaded: its length is that of the replay, never more than the limit. A
plan may allow less than 60 minutes: when Probara refuses a recording as too long, the Vis keeps the
recording up to the plan limit. Credentials, cookies, tokens and passwords are redacted in the page,
and again before anything is sent. When nothing was captured, no Vis is created. On success stdout
holds the ULID, the display ID and the URL of the Vis, separated by spaces.

Example:
  probara vis record --cdp http://127.0.0.1:9222 --duration 60 --title "Checkout fails"

Options:
  --base-url <url>          Probara URL
                            env: PROBARA_BASE_URL
                            default: https://app.probara.net
  --title <text>            Title of the Vis, 1 to 200 characters; the title of the page when
                            omitted
  --description <markdown>  Description of the Vis, in Markdown
  --folder <ulid>           Folder of the Vis (its ULID)
  --private                 Create the Vis private: only you, the members and groups you grant, and
                            owners and admins see it
  --metadata <key=value>    Custom metadata of the Vis, such as build=1.42.0; at most 10 KB in all
                            (repeatable)
  --cdp <endpoint>          The Chrome DevTools Protocol endpoint of the browser: its debugging
                            port, such as http://127.0.0.1:9222, or the WebSocket debugger URL of
                            the browser or of one page
  --target <page>           The page to record: its target id, or part of its URL; required when the
                            browser has several pages
  --duration <seconds>      Stop the recording after this many seconds
                            default: until stopped, at most 60 minutes
  --timeout <ms>            Timeout of one HTTP attempt, in milliseconds
                            default: 30000
  --max-retries <n>         Retries of a failed request, 0 to 10
                            default: 4
  --json                    Print the created Vis, with its url, as JSON on stdout
  --debug                   Log every request
                            env: PROBARA_DEBUG
                            default: false
  -h, --help                Show this help

Environment:
  PROBARA_API_TOKEN  A personal API token (required): app tokens (probara_app_...) can only report
                     results. There is no flag for it: a command line leaks.
  PROBARA_ENABLED    false turns reporting off: nothing is sent, and the exit code is 0 unless the
                     command line is wrong (exit 2).

Exit codes:
  0  Done: the recording is a Vis; or disabled by PROBARA_ENABLED=false: nothing was recorded or
     sent.
  1  The browser could not be reached or the recording failed; or nothing was captured, and no Vis
     was created; or Probara refused the Vis or an upload (the log says why), or could not be
     reached after the retries. A Vis whose upload failed was deleted again, unless the log says
     Probara could not be reached for that either: Probara then deletes it seven days after its
     creation.
  2  Usage or configuration error (unknown option, invalid value, not configured, no --cdp, a
     browser with several pages and no --target, a --target that matches no page or several).
     Nothing was recorded or sent.
```

Start a Chromium browser with a debugging port, or use the one your agent or test runner drives,
then record the page it works in:

```bash
probara vis record --cdp http://127.0.0.1:9222 --duration 60 --title "Checkout fails"
```

<!-- output: vis -->

```text
$ probara vis record --cdp http://127.0.0.1:9222
[probara] Recording "Checkout" (https://shop.example.com/checkout): stop with Ctrl+C, or close the page
[probara] The page closed: the recording ends
[probara] Recorded 4.0 s: 6 replay events, 1 console message, 1 request, 1 action
[probara] Created VIS-13: uploading the replay (1 KiB)
[probara] Uploaded VIS-13: https://app.probara.net/vis/VIS-13
01J9Z3K4M5N6P7Q8R9S0T1V2W3 VIS-13 https://app.probara.net/vis/VIS-13
```

- `--cdp` takes the debugging port of the browser (Chrome started with
  `--remote-debugging-port=9222`, or Playwright's `chromium.launch({ args: ['--remote-debugging-port=9222'] })`),
  or a WebSocket debugger URL: the browser's, or one page's from `http://127.0.0.1:9222/json/list`.
  Whoever reaches a debugging port controls the browser: keep it on `127.0.0.1`.
- With several pages open, `--target` picks one by its id or by part of its URL; without it the
  command lists the pages and exits 2.
- A replay rebuilds the page from its DOM; it is not a video. The content of a cross-origin
  iframe and what a canvas draws are not recorded.
- The recording follows the page across navigations and stops when the page closes. Ctrl+C
  stops it and uploads what was recorded; a second Ctrl+C, while it uploads, ends the command.
- The CLI records at most 60 minutes, the longest any plan allows. When Probara refuses the
  length, its answer names the plan's limit, and the Vis keeps the first minutes up to it.
- Everything the page sends is checked before it is kept: a message larger than 32 MiB, or one
  that is not capture data, is dropped and counted in the log. The replay is written to a
  temporary file as it arrives (at most 1 GiB); the console, network and user event streams
  keep their newest entries within the limits of the capture engine.

## See also

- [Gherkin](gherkin.md): syncing `.feature` files, and importing Cucumber JSON results.
- [Configuration](configuration.md): every option, its variable and its default.
- [Sharded runs](ci/sharding.md): `run create`, the shards, then `run close`.
- [Exit codes](exit-codes.md).
- [Vises API](https://docs.probara.net/en/developers/api/vises/): what the `vis` commands call.
