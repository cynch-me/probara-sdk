# Commands

`probara` has three commands. Each one reads its options from flags and `PROBARA_*` variables
([configuration](configuration.md)), logs on stderr and keeps stdout for machine output
([debugging](debugging.md)).

| Command                                         | Use it to                                            |
| ----------------------------------------------- | ---------------------------------------------------- |
| [`probara import junit`](#probara-import-junit) | Import JUnit XML files into one run                  |
| [`probara run create`](#probara-run-create)     | Create a run up front, for shards that share it      |
| [`probara run close`](#probara-run-close)       | Close a shared run once every shard reported into it |

The help below is the real output of each `--help`: the docs tests check it byte for byte.

## `probara`

<!-- help: probara -->

```text
Usage: probara <command> [options]

Report automated test results to Probara from any CI.

Commands:
  import junit <paths...>  Import JUnit XML files into one Probara run
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
  --base-url <url>              Probara URL
                                env: PROBARA_BASE_URL
                                default: https://app.probara.net
  --run-ulid <ulid>             An existing run: import into it instead of creating one, or close it
                                env: PROBARA_RUN_ULID
  --run-name <name>             Name of a new run
                                env: PROBARA_RUN_NAME
                                default: the CI build name, else "Automated run <date> UTC"
  --environment-id <ulid>       Environment of a new run
                                env: PROBARA_ENVIRONMENT_ID
  --milestone-id <ulid>         Milestone of a new run
                                env: PROBARA_MILESTONE_ID
  --configuration <ulid>        Configuration of a new run (repeatable, or comma-separated)
                                env: PROBARA_CONFIGURATION_ULIDS
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
  --root-dir <dir>              Directory the file paths of automation keys are relative to
                                default: the current directory
  --fail-on-failed-tests        Exit 3 when a test failed or was blocked
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
     matched, invalid XML). Nothing was sent.
  3  A test failed or was blocked, and --fail-on-failed-tests was given. Codes 1 and 2 win.
```

### What it does

1. Expands every path: a file, a directory (every `*.xml` beneath it) or a glob. Patterns keep
   their order, the files of each pattern are sorted, and a file matched twice is read once. A
   pattern that matches nothing is a warning; when none matches, the command exits 2. Glob
   patterns use `/`, even on Windows
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
  --project <code>         Project code, such as SHOP
                           env: PROBARA_PROJECT
  --base-url <url>         Probara URL
                           env: PROBARA_BASE_URL
                           default: https://app.probara.net
  --run-name <name>        Name of a new run
                           env: PROBARA_RUN_NAME
                           default: the CI build name, else "Automated run <date> UTC"
  --environment-id <ulid>  Environment of a new run
                           env: PROBARA_ENVIRONMENT_ID
  --milestone-id <ulid>    Milestone of a new run
                           env: PROBARA_MILESTONE_ID
  --configuration <ulid>   Configuration of a new run (repeatable, or comma-separated)
                           env: PROBARA_CONFIGURATION_ULIDS
  --tag <tag>              Tag of a new run (repeatable, or comma-separated)
                           env: PROBARA_RUN_TAGS
  --branch <name>          Branch of the run source
                           env: PROBARA_BRANCH
                           default: detected from the CI
  --commit <sha>           Commit of the run source
                           env: PROBARA_COMMIT
                           default: detected from the CI
  --build-url <url>        CI build URL of the run source
                           env: PROBARA_BUILD_URL
                           default: detected from the CI
  --no-source              Send no run source (branch, commit, build URL)
  --timeout <ms>           Timeout of one HTTP attempt, in milliseconds
                           default: 30000
  --max-retries <n>        Retries of a failed request, 0 to 10
                           default: 4
  --json                   Print a JSON summary on stdout
  --debug                  Log every request
                           env: PROBARA_DEBUG
                           default: false
  -h, --help               Show this help

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
- A run that is already closed or aborted is not an error: the command logs it and exits 0, and
  `--json` prints `"status": "already_closed"`.
- A close that failed after the retries exits 1. The run stays open until you run the command
  again or close it in Probara.

## See also

- [Configuration](configuration.md): every option, its variable and its default.
- [Sharded runs](ci/sharding.md): `run create`, the shards, then `run close`.
- [Exit codes](exit-codes.md).
