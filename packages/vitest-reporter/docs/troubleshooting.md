# Troubleshooting

Each entry starts from what you see, then says why and what to do. The reporter logs on stderr in
`[probara]` lines; [`PROBARA_DEBUG=true`](debugging.md#probara_debug) adds every request. Whatever
the problem, Vitest's exit code stays the tests' own. The
[last section](#every-line-the-reporter-logs) lists every line the reporter logs.

## Nothing is reported, and nothing is logged

**Why.** Without a token and a project, the reporter stays off and quiet, on purpose: local runs and
fork builds send nothing. It says so only at debug:

<!-- output: default, scenario: not-configured -->

```text
$ PROBARA_DEBUG=true npx vitest run
[probara] Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it
```

**Solution.** Give the step that runs `vitest` the `PROBARA_API_TOKEN` secret, and set the project
(`projectId` or `PROBARA_PROJECT`). Check that the reporter is in the `reporters` of the root
config Vitest uses: `--reporter` on the command line replaces the config's reporters, so
`vitest run --reporter=dot` runs without the reporter, and with no `[probara]` line at all.

## Reporting is off: a configuration problem

<!-- output: default -->

```text
$ PROBARA_RUN_ULID=R-12 npx vitest run
[probara] Probara reporting is off: PROBARA_RUN_ULID is not a ULID
```

**Why.** A setting has a wrong value, or only one of the token and the project is set. Each problem
is logged, naming the option or variable at fault (never its value), and nothing is sent. The
most common: `The API token is not set: pass apiToken or set PROBARA_API_TOKEN`, and
`The project is not set: pass projectId or set PROBARA_PROJECT`.

**Solution.** Fix the setting the line names ([configuration](configuration.md#options)).

## Probara answers 401 or 403

<!-- output: default, scenario: unauthorized -->

```text
$ npx vitest run
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 401 unauthorized: <message from Probara>. No run was created or updated
```

**Why.** `401`: the token is wrong, revoked, or from another Probara (`baseUrl`). `403`: the token
cannot report to that project, or the organization is on the free plan (reporting from CI needs a
paid plan).

**Solution.** Create a new app token from the **Vitest** card
([get a token](configuration.md#get-a-token)) and update the secret; check the project code; check
the organization's plan.

## The run was left open

The error line ends with `The run R-4 was left open: <url>`, or, when not even the first report
went through, `No run was created or updated`. After the retries, the reason reads like
`Could not send the report after 5 attempts: the last one timed out after 30000 ms`.

**Why.** A report failed after its retries (Probara unreachable, a refused report): the reports
after it are not sent, and a run that already has results stays open, so nothing looks complete
when it is not. A run of a [watch session](watch.md) and a reused run (`run.ulid`) stay open on
purpose.

**Solution.** Set a [results file](results-file.md): what was not sent goes there, with the run it
belongs to, and `probara import results` sends it into that run and closes it. Otherwise close the
run by hand with `npx @probara/cli run close --run-ulid <ulid>`, and run the tests again.

## Results were not recorded (unmatched)

<!-- output: default -->

```text
$ PROBARA_CREATE_MISSING_CASES=false npx vitest run --no-file-parallelism
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (0 new cases, 2 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] 2 results were not recorded (case_not_found): tests/cart.test.ts > cart > removes an item; tests/login.test.ts > login > logs in with a valid password
```

**Why.** A result names a case that does not exist (a typo in an id, a case of another project), or
matches no case while `createMissingCases` is off. Probara records the others and says which were
left out, with the reason.

**Solution.** Fix the id, create the case, or let the reporter create missing cases (the default).

## Every run creates new cases

**Why.** The automation keys changed: a test, `describe` or file was renamed or moved, `vitest` runs
with another root than before (keys are relative to it), `keyIncludesFile` changed
([what changes a key](linking.md#automation-keys)), or a Vitest upgrade writes some `test.each`
titles differently ([from Vitest 4 to 5](upgrade.md#from-vitest-4-to-5)).

**Solution.** Name the cases in the titles ([linking](linking.md)), so a rename keeps them. Set
`rootDir` when `vitest` runs from different directories. Before a refactor or an upgrade,
[compare the keys](debugging.md#check-what-would-be-sent).

## A test file is not reported

**Why.** Vitest never ran it: `--bail` stopped the run first, or the run was interrupted (`Ctrl+C`).
It has no test to report, and one warning counts such files:
`Vitest did not run 1 test file of this run: nothing of it is reported`. A file Vitest ran but could
not load is reported: one failed result named after the file
([errors outside a test](statuses.md#errors-outside-a-test)).

**Solution.** Run the tests again without `--bail`, or let the run finish. The tests Vitest left
waiting in a file it had started are sent as skipped, with the note
`Not run: the test run was interrupted` ([statuses](statuses.md)).

## Only the last attempt of a retried test was sent

**Why.** The reporter's setup file did not run in those tests, so their earlier attempts left no
record, and one warning says how many:
`Vitest retried or repeated 1 test whose earlier attempts were not recorded: only its final attempt is reported`.
Either a shard ran with `--reporter=blob` on the command line, which replaces the config's
reporters, or the reporter could not add its setup file to a project (a warning at the start names
the project).

**Solution.** List the reporter beside `blob` in the reporters of the shards' config, rather than
`--reporter=blob` on the command line ([when retries run](retries.md#when-retries-run)).

## A helper warns that it only works while a test runs

**Why.** A `probara.*` helper was called outside a test: at the top of a file, in a `describe` body,
`beforeAll` or `afterAll`. Nothing is recorded, and the test goes on. The warning is in the test
file's output (`stderr | tests/...`), once per helper and file.

**Solution.** Call it in the test, `beforeEach`, `afterEach` or `onTestFinished`
([where to call the helpers](metadata.md#where-to-call-the-helpers)).

## A helper call was dropped

| You see                                                                                                                         | Why, and what to do                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probara.<helper>() is dropped in a concurrent test: this worker cannot tell which test calls it without the reporter's runner` | A `test.concurrent` test where the reporter's runner does not run: in [browser mode](browser-mode.md), or under a custom `runner` Node cannot import. Make the test sequential, or write the runner in JavaScript                                   |
| `the runner of project "<name>" is <path>, which Node does not import: the reporter keeps it as it is`                          | The project's custom `runner` is a file Node's own `import()` cannot load (`.jsx`, `.tsx`): the reporter leaves it as it is. Attempts are still recorded; the calls of its `test.concurrent` tests are dropped. Write the runner in `.js` or `.mjs` |
| `the runner of project "<name>" is TypeScript, which this Node cannot import: the reporter keeps it as it is`                   | The same, for a `.ts` runner on a Node that cannot run TypeScript itself. Use a newer Node, or write the runner in JavaScript                                                                                                                       |
| `the probara.* helpers cannot see the running test: <reason>`                                                                   | Vitest's way to name the running test failed in that worker (a Vitest the reporter does not know yet): its helper calls are dropped. Report it, with the Vitest version                                                                             |
| `probara.<helper>() could not be recorded: <reason>`                                                                            | The helper failed inside, and the call is ignored. Report it                                                                                                                                                                                        |
| No warning, and nothing recorded                                                                                                | The reporter is not in the run's reporters (`--reporter` on the command line): every helper then does nothing, and `probara.step()` still runs its body                                                                                             |

## Run selection ran every test

**Why.** With `runCasesOnly`, the reporter could not tell which tests belong to the run, so every
test ran and was reported, rather than none. One warning says why: no `PROBARA_RUN_ULID`, the run's
cases could not be read (a wrong ULID, a token of another organization), a browser project, or a
shard that writes a blob.

**Solution.** Follow the warning ([when it cannot select](run-selection.md#when-it-cannot-select)).
When every test was skipped instead, no test belongs to the run: check the ULID, and that the tests
name the run's cases or have their keys.

## captureOutput attaches nothing

**Why.** `captureOutput` is off (the default), or the output is of a kind it leaves out: a
`test.concurrent` test (one warning counts them), output written outside a test (the file's own
code, a `beforeAll` or `afterAll`), or a retried test whose attempts were not recorded
([captured output](output.md)).

**Solution.** Turn `captureOutput` on, and log with `console` inside the test, a `beforeEach` or an
`afterEach`, in a test that is not `test.concurrent`.

## An attachment is missing

**Why.** The log names every file it left out, and why: the file did not exist when
`probara.attach()` ran (it is copied at once), it is a folder or over 32 MiB, an image over 10 MiB
or 8192 px, a refused content type, more than 20 files in one result, or, at a merge, a copy the
blob names that did not come along with `attachmentsDir`
([limits](attachments.md#limits-and-what-is-skipped)). A file attached inside a step goes to that
step, not to the result.

**Solution.** Attach a file that exists when you call `probara.attach()`, await the call, keep files
under the limits, and carry `attachmentsDir` with the blobs
([where the copies are kept](attachments.md#where-the-copies-are-kept)).

## Browser mode

| You see                                                                                                                                       | Why, and what to do                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `probara.attach() did not attach "<name>": Vite does not serve "<file>" (server.fs.allow or server.fs.deny)`                                  | The file is outside the folders Vite serves, or Vite denies it. Attach a file inside the project, or a body ([browser mode](browser-mode.md#probaraattach-in-a-browser)) |
| `probara.attach() did not attach "<name>": Vite's file rules are not reachable from this run, so "<file>" is not served`                      | The reporter could not load the Vite the project's Vitest runs with, so it reads no path. Attach a body, and report it                                                   |
| `probara.attach() "<name>" of "<test>" settled after the test ended, so it is not attached. Await probara.attach() before the test ends`      | The test did not await the call: `await probara.attach(...)`                                                                                                             |
| `Vite <version> has no isFileLoadingAllowed (it arrived in 5.4): the browser attach follows its isFileServingAllowed`                         | A notice, once per process: Vite 5.0 to 5.3 have an older file check, which decides. Upgrade Vite to 5.4 or later to get its current rules                               |
| `Vite <version> exports neither isFileLoadingAllowed nor isFileServingAllowed: the browser attach refuses every path`                         | A notice, once per process: that Vite has no file check, so no path is read. Attach bodies, or upgrade Vite                                                              |
| `runCasesOnly does not apply in browser mode yet: the tests of project "<name>" run and are reported`                                         | Run selection is not supported in browser mode yet: every test of the project runs and is reported                                                                       |
| `could not add the browser setup file to project "<name>" (<reason>): ...`                                                                    | That project records no attempt and no helper call. Report it, with the Vitest version                                                                                   |
| `could not add the browser commands to project "<name>" (<reason>): ...`, `could not give the browser commands to project "<name>": <reason>` | `probara.attach()` copies no file in that project. Report it, with the Vitest version                                                                                    |

## A shard sends nothing

`Sharded run with the blob reporter: the results are reported by vitest --merge-reports` is
expected: a shard that writes a blob sends nothing, so that no result is sent twice. Run
`vitest --merge-reports` with the reporter in its config: that run reports every shard. A shard
with `--reporter=blob` on the command line runs without the reporter, and logs nothing.

## Unhandled errors are not sent

**Why.** Errors no test owns (a promise no test awaited, an error thrown from a timer) are not
results. Vitest fails the run for them; Probara gets no result, since no test failed, and one
warning counts them
([errors outside a test](statuses.md#errors-outside-a-test)):
`Vitest reported 2 unhandled errors outside the tests: they are not results, and nothing is sent for them`.

**Solution.** Fix the code: Vitest's output above the `[probara]` lines shows the error in full.

## Probara answers 429 (too many requests)

**Why.** The organization's rate limit (60 requests per minute by default) is shared by every token
and pipeline. Attachments cost two requests per result ([rate limit](network.md#rate-limit)).

**Solution.** The reporter waits and retries on its own. For large suites, attach less, lower
`attachmentConcurrency`, or spread sharded pipelines in time.

## Every line the reporter logs

Every `[probara]` line, the reporter's own and those of the reporting library it shares with the
other Probara reporters and the CLI. `<...>` stands for what changes. A warning that can repeat
ends with `(first seen in the run; repeats are logged at debug)`, or names the result it was first
seen in, and is logged at debug afterwards. **Where** is the reporter's log on stderr (log), or the
output of the test file, which Vitest prints under `stderr | tests/...` (test output). The token
never appears in any line, even when Probara's answer echoes it.

### Setup and configuration

| Line                                                                                                                            | Level | What to do                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it`                                   | debug | [Nothing is reported](#nothing-is-reported-and-nothing-is-logged)                                          |
| `Probara reporting is disabled by PROBARA_ENABLED` (or `by the enabled option`)                                                 | debug | Reporting was turned off on purpose                                                                        |
| `Probara reporting is off: <problem>`                                                                                           | error | [A configuration problem](#reporting-is-off-a-configuration-problem)                                       |
| `Probara reporting is off: options must be an object`                                                                           | error | Give the options as an object: `['@probara/vitest-reporter', { projectId: 'SHOP' }]`                       |
| `Ignored the unknown option "<name>" of @probara/vitest-reporter`                                                               | warn  | A typo in an option name ([configuration](configuration.md#options))                                       |
| `Ignored <options>: a reused run (run.ulid) keeps its own`                                                                      | warn  | A reused run keeps its name and settings ([an existing run](runs.md#an-existing-run))                      |
| `Truncated the run name to 200 characters`, `Truncated the run description to 2000 characters`                                  | warn  | Shorten them                                                                                               |
| `Dropped <n> run tags beyond the limit of 50`                                                                                   | warn  | Send fewer run tags                                                                                        |
| `Ignored source.<field>: it must be a string`, `Ignored a blank source branch`, `Ignored a source <field> ...`                  | warn  | Fix the field of `source` or its variable ([run source](runs.md#run-source))                               |
| `Ignored the run of <code> in PROBARA_RUN_ULIDS: <code> is not the project nor one of projects` (or `run.ulids`)                | warn  | List the project in `projects`, or drop its run ([several projects](projects.md#several-probara-projects)) |
| `The run of <code> is reused (...), but <codes> has no run in run.ulids: ...`                                                   | warn  | Give every project a run ([sharded jobs](projects.md#sharded-jobs))                                        |
| `Sent <fields> with the run of <code> only: they belong to one project. ...`                                                    | warn  | Create the other projects' runs with their own ([one run per project](projects.md#one-run-per-project))    |
| `could not register project "<name>": <reason>`                                                                                 | warn  | That project may run without the reporter's setup file. Report it                                          |
| `could not add the setup file to project "<name>" (<reason>): its retries and repeats are reported as their final attempt only` | warn  | Report it, with the Vitest version                                                                         |
| `could not give project "<name>" its attachments folder (<reason>): its files are not attached`                                 | warn  | Report it                                                                                                  |
| `the runner of project "<name>" is <path>, which Node does not import: the reporter keeps it as it is`                          | warn  | [A helper call was dropped](#a-helper-call-was-dropped)                                                    |
| `the runner of project "<name>" is TypeScript, which this Node cannot import: the reporter keeps it as it is`                   | warn  | [A helper call was dropped](#a-helper-call-was-dropped)                                                    |
| `could not wrap the runner of project "<name>" (<reason>): the reporter keeps it as it is`                                      | warn  | Report it                                                                                                  |

### Sending and recording

| Line                                                                                                                                                                        | Level | What to do                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `Sending <n> results of <m> tests (...)`, then `; <k> left out by statusFilter`, `; <k> ignored with probara.ignore()` or `; <k> linked only to cases of unlisted projects` | info  | What the run hands to Probara ([the log](debugging.md#the-log))                |
| `Recorded <n> results (<c> new cases, <u> unmatched) in R-1 (closed): <url>`, `in R-1 of <project>` with several projects                                                   | info  | Nothing: the run is in Probara                                                 |
| `Filtered out <n> results by their status (statusFilter): not sent`                                                                                                         | info  | [Status filter](statuses.md#status-mapping-and-filter)                         |
| `<n> results were not recorded (<reason>): <cases or keys>`                                                                                                                 | warn  | [Unmatched results](#results-were-not-recorded-unmatched)                      |
| `<n> results were not sent: <reason>. No run was created or updated`, `... The run R-1 was left open: <url>`                                                                | error | [401 or 403](#probara-answers-401-or-403), [left open](#the-run-was-left-open) |
| `Probara warned: <warning>`                                                                                                                                                 | warn  | Read Probara's warning, such as [assignFailedTo](assign-failed.md)'s count     |
| `Did not send the results linked to cases of <code>: <code> is neither the project (<project>) nor one of projects (PROBARA_PROJECTS)`                                      | warn  | [Several Probara projects](projects.md#what-goes-where)                        |
| `<Request> attempt <n> of <m> got <status>; retrying in <ms> ms`, `... timed out after <ms> ms; ...`, `... failed: <error>; ...`                                            | warn  | Nothing: the request is retried ([network](network.md#retries-and-backoff))    |
| `Sending <request> <id> (attempt <n> of <m>)`                                                                                                                               | debug | [`PROBARA_DEBUG`](debugging.md#probara_debug)                                  |
| `The run R-1 was already closed or aborted`                                                                                                                                 | info  | Nothing: someone closed the run before the reporter did                        |
| `Could not close the run R-1: <reason>. It was left open: <url>`                                                                                                            | error | Close it by hand: `npx @probara/cli run close --run-ulid <ulid>`               |
| `Wrote the <n> results that were not sent to <file>: send them with probara import results <file>`                                                                          | warn  | [Results file](results-file.md)                                                |
| `Wrote <n> results to <file>: send them with probara import results <file>` (reporting off)                                                                                 | info  | [Results file](results-file.md#reporting-off-keep-everything)                  |
| `Could not write the results file <file>: <reason>`                                                                                                                         | error | Check that the folder of the file can be written                               |
| `Could not keep a copy of the attachment <name> (<path>) next to the results file (<code>): ...`                                                                            | warn  | The file points at the original: import it before that file goes               |

### Watch mode and shards

| Line                                                                                                                                | Level | What to do                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `Watch mode: every re-run reports into R-1 of <project>, which stays open: close it in Probara, or with probara run close ...`      | info  | Close the run when the session ends ([watch mode](watch.md))                                        |
| `The run R-1 of <project> was closed: sent the <n> results of this re-run into a new run` (or `deleted`)                            | info  | Nothing: the session goes on in the new run                                                         |
| `The run R-1 of <project> was closed: sent the <n> results it did not record into a new run; the rest of this re-run is in R-1`     | info  | Nothing: the re-run is split over both runs                                                         |
| `The run R-1 of <project> was closed: the results file <file> keeps this re-run, but names R-1, which refuses it: send it with ...` | info  | Import the file into an open run ([watch mode](watch.md#when-the-run-is-closed-during-the-session)) |
| `Sharded run with the blob reporter: the results are reported by vitest --merge-reports`                                            | info  | [A shard sends nothing](#a-shard-sends-nothing)                                                     |

### Run selection

| Line                                                                                                                                | Level | What to do                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `Ran only the tests of run <ULID>: <k> of <m> tests match its cases; <n> skipped and not reported`                                  | info  | Nothing ([run selection](run-selection.md))                                    |
| `No test matches the cases of the run <ULID>: every test was skipped, and none is reported`                                         | warn  | Check the ULID ([run selection ran every test](#run-selection-ran-every-test)) |
| `runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported`                  | warn  | Set the ULID                                                                   |
| `runCasesOnly: could not read the cases of the run <ULID> (<reason>). Every test runs and is reported`                              | warn  | Check the ULID and the token                                                   |
| `runCasesOnly does not apply to a sharded run with the blob reporter: every test runs, and vitest --merge-reports reports them all` | warn  | [Run selection](run-selection.md#setups)                                       |
| `runCasesOnly does not apply in browser mode yet: the tests of project "<name>" run and are reported`                               | warn  | [Browser mode](browser-mode.md#not-supported-yet)                              |
| `runCasesOnly needs the setup file in project "<name>": its tests run and are reported`                                             | warn  | The setup file could not be added to that project: report it                   |
| `could not give project "<name>" the cases of the run (<reason>): its tests all run and are reported`                               | warn  | Report it, with the Vitest version                                             |

### Helpers

These are logged once per run, unless **Where** says test output.

| Line                                                                                                                                                                                                                                                                  | Where       | What to do                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `probara.<helper>() only works while a test runs (in a test, or a beforeEach or afterEach hook)`                                                                                                                                                                      | test output | [A helper warns](#a-helper-warns-that-it-only-works-while-a-test-runs)                                         |
| `probara.<helper>() is dropped in a concurrent test: this worker cannot tell which test calls it without the reporter's runner`                                                                                                                                       | test output | [A helper call was dropped](#a-helper-call-was-dropped)                                                        |
| `the probara.* helpers cannot see the running test: <reason>`                                                                                                                                                                                                         | test output | [A helper call was dropped](#a-helper-call-was-dropped)                                                        |
| `probara.id() takes a case id or a list of case ids, such as PRB-12`, `probara.title() takes a string`, `probara.suite() takes a suite title or a list of suite titles`, `probara.comment() takes a string`                                                           | log         | A wrong argument: the call is ignored ([metadata](metadata.md))                                                |
| `probara.parameters() takes an object of strings, numbers or booleans`, `probara.fields() takes an object of strings, numbers or booleans`, `probara.tags() takes strings`                                                                                            | log         | A wrong argument: the call is ignored ([metadata](metadata.md))                                                |
| `probara.link() takes an absolute http(s) URL of at most 2048 characters`, `probara.link() takes the name as a string`, `probara.issue() takes an issue id (a string), such as PRB-7`                                                                                 | log         | A wrong argument: the call is ignored ([links](links.md))                                                      |
| `probara.<helper>() ignores blank <values>`                                                                                                                                                                                                                           | log         | A blank tag, id or suite: it is left out                                                                       |
| `probara.<helper>() could not be recorded: <reason>`                                                                                                                                                                                                                  | log         | Report it                                                                                                      |
| `probara.step() takes an action (a string)`, `probara.step() takes the expected result as a string`, `probara.step() takes the data as a string`, `probara.step() takes its options as an object ({ expected, data })`, `probara.step() takes a function as its body` | log         | Fix the call ([steps](steps.md))                                                                               |
| `Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links`                                                                                                                                                                               | log         | Set `issueUrlTemplate` ([links](links.md#probaraissue-and-issueurltemplate))                                   |
| `Dropped a link without an absolute http(s) URL of at most 2048 characters`                                                                                                                                                                                           | log         | Give `probara.link()` an absolute `http(s)` URL ([links](links.md))                                            |
| `Ignored malformed probara metadata (type "<type>")`                                                                                                                                                                                                                  | log         | Something wrote to `task.meta.probara`, which is the reporter's ([metadata](metadata.md#how-metadata-travels)) |

A warning of a call that belongs to no test is printed in the test output, whatever its text.

### Attachments and output

| Line                                                                                                                                                                             | Level | What to do                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `probara.attach() did not attach "<name>": it does not exist`, `it cannot be read`, `it is not a file`, `it is larger than 32 MiB`, `it cannot be copied (<code>)`               | warn  | [An attachment is missing](#an-attachment-is-missing)                                |
| `probara.attach() takes { name, path } or { name, body }`, `probara.attach() could not attach "<name>": its contentType is not a string`, `... it has neither a path nor a body` | warn  | Fix the call ([attachments](attachments.md#probaraattach))                           |
| `probara.attach() could not attach "<name>": this run has no attachments folder`                                                                                                 | warn  | The project got no attachments folder: a warning at the start says why               |
| `Attached <n> files to results (<s> skipped, <f> failed)`                                                                                                                        | info  | Nothing; a warning when some failed                                                  |
| `Skipped an attachment: <reason> (first seen in "<test>", <name>; ...)`                                                                                                          | warn  | [Limits](attachments.md#limits-and-what-is-skipped)                                  |
| `Skipped the attachments beyond the first 20 uploadable ones of a result`                                                                                                        | warn  | Attach fewer files per test                                                          |
| `Could not attach <n> files to the result of "<test>": <reason>`                                                                                                                 | warn  | The result is recorded without them; check the network ([network](network.md))       |
| `Skipped an annotate file "<name>": Vitest 3 loses some bytes of a binary body, so it cannot be sent intact; attach the file with a path instead`                                | warn  | [Vitest annotations](attachments.md#vitest-annotations)                              |
| `<n> annotated files are left out: the attempt each belongs to cannot be told apart`                                                                                             | warn  | [Only the last attempt was sent](#only-the-last-attempt-of-a-retried-test-was-sent)  |
| `The console output of <n> tests are left out: Vitest attributes the writes of concurrent tests to the wrong test, ...`                                                          | warn  | [captureOutput attaches nothing](#captureoutput-attaches-nothing)                    |
| `[probara] The output of this test was cut here: an attachment holds at most 32 MiB`                                                                                             | —     | A line inside `stdout.log` or `stderr.log`, not the log ([limits](output.md#limits)) |

### Vitest's run

| Line                                                                                                                    | Level | What to do                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `Vitest did not run <n> test files of this run: nothing of them are reported`                                           | warn  | [A test file is not reported](#a-test-file-is-not-reported)                         |
| `Vitest retried or repeated <n> tests whose earlier attempts were not recorded: only their final attempts are reported` | warn  | [Only the last attempt was sent](#only-the-last-attempt-of-a-retried-test-was-sent) |
| `Vitest reported <n> unhandled errors outside the tests: they are not results, and nothing is sent for them`            | warn  | [Unhandled errors](#unhandled-errors-are-not-sent)                                  |

### In browser mode

| Line                                                                                                                                    | Level | What to do                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------- |
| `probara.attach() did not attach "<name>": Vite does not serve "<file>" (server.fs.allow or server.fs.deny)`                            | warn  | [Browser mode](#browser-mode)      |
| `probara.attach() did not attach "<name>": Vite's file rules are not reachable from this run, so "<file>" is not served`                | warn  | [Browser mode](#browser-mode)      |
| `probara.attach() "<name>" of "<test>" settled after the test ended, so it is not attached. Await probara.attach() ...`                 | warn  | Await the call (test output)       |
| `Vite <version> has no isFileLoadingAllowed (it arrived in 5.4): the browser attach follows its isFileServingAllowed`                   | warn  | [Browser mode](#browser-mode)      |
| `Vite <version> exports neither isFileLoadingAllowed nor isFileServingAllowed: the browser attach refuses every path`                   | warn  | [Browser mode](#browser-mode)      |
| `could not add the browser setup file to project "<name>" (<reason>): its retries and repeats are reported as their final attempt only` | warn  | Report it, with the Vitest version |
| `could not add the browser commands to project "<name>" (<reason>): its probara.attach() copies no file`                                | warn  | Report it, with the Vitest version |
| `could not give the browser commands to project "<name>": <reason>`                                                                     | warn  | Report it, with the Vitest version |

### Limits of a result

Probara's limits per result, each a warning that names the first result it was seen in:

| Line                                                                                                                                | Limit                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `Dropped the steps beyond the first 200 of a result`, `Dropped the steps nested deeper than 10 levels`                              | Steps of a result        |
| `Dropped the case steps beyond the first 500`, `Dropped a case step without an action`                                              | Steps of a created case  |
| `Dropped the parameters beyond the first 20 of a result`, `Truncated a parameter name longer than 100 characters`                   | Parameters               |
| `Ignored a parameter with a blank name`, `Ignored a parameter whose name repeats another once trimmed`                              | Parameters               |
| `Dropped the case tags beyond the first 50`                                                                                         | Tags of a created case   |
| `Dropped the case fields beyond the first 50`, `Ignored a case field whose name is longer than 200 characters`                      | Fields of a created case |
| `Ignored a case field with a blank name`, `Ignored a case field whose name repeats another once trimmed and compared ignoring case` | Fields of a created case |
| `Dropped the links beyond the first 20 of a result`, `Truncated a link name longer than 255 characters`                             | Links                    |
| `Ignored a caseDisplayId longer than 64 characters`                                                                                 | Case ids                 |

### Errors to report

These lines mean the reporter met something it did not expect. The run goes on, and what the line
names is lost (a test, a file, the console output of a test) or left as it was (the copies of the
run's files). Report them at
[github.com/cynch-me/probara-sdk/issues](https://github.com/cynch-me/probara-sdk/issues), with the
`[probara]` lines of a run with `PROBARA_DEBUG=true` and the Vitest version.

| Line                                                                                                                                             | Level |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `Probara reporting is off: the reporter could not start: <reason>`                                                                               | error |
| `Could not report <file>: <reason>`, `Could not report "<test>": <reason>`, `Could not report the failure of <name>: <reason>`                   | error |
| `Could not finish reporting: <reason>`, `Could not read the cases of the run: <reason>`, `Could not keep the console output of a test: <reason>` | error |
| `Could not remove the attachment copies of this run: <reason>` (remove `<attachmentsDir>/probara/` by hand)                                      | error |
| `Skipped the invalid result of "<test>": <reason>`, `Ignored results added after complete()`                                                     | warn  |
| `Ignored <a value> that is not <a type>`, such as `Ignored steps that are not a list`, and `Ignored a blank caseDisplayId`                       | warn  |

## See also

- [Debugging](debugging.md).
- [Network](network.md).
