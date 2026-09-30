# Watch mode

`jest --watch` and `jest --watchAll` re-run tests as you save files. The reporter gives the whole
session **one** Probara run: the first run creates it, every re-run reports into it, and it stays
open, since a closed run would refuse the next re-run.

<!-- output: default -->

```text
$ npx jest --watchAll
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (0 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

Above, the first run created `R-1` and said so once; a test file was saved, and the re-run reported
into the same run.

| In a watch session                                 | What the reporter does                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| The first run (or re-run) with results             | Creates the run, and logs the `Watch mode` line with the command that closes it |
| Every later re-run                                 | Reports into that run: each re-run's results add to its cases' history          |
| The end of the session (`q`, `Ctrl+C`)             | Nothing: the run stays open. Close it in Probara, or with the logged command    |
| `closeRun`, `closeRuns`                            | Ignored: a watch session never closes its runs                                  |
| `run.ulid` (`PROBARA_RUN_ULID`)                    | Every re-run reports into that run, which stays open                            |
| [`projects`](projects.md#several-probara-projects) | One run per Probara project, created with its first result                      |
| [`runCasesOnly`](run-selection.md)                 | The run's cases are read again before each re-run                               |

Close the session's run when you are done:

```bash
npx @probara/cli run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

Watch mode is for your own machine: the reporter reports only with a token and a project, so a
local session sends nothing unless you set them. The `probara.*` helpers and the setup file work in
watch mode as in any run.

## When the run is closed during the session

Someone may close (or delete) the session's run in Probara while you keep working. The next re-run
is refused, so the reporter sends that re-run's results into a new run at once, and every later
re-run reports into the new one:

<!-- output: default, scenario: watch-run-closed -->

```text
$ npx jest --watchAll
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 409 conflict: <message from Probara>. No run was created or updated
[probara] The run R-1 of SHOP was closed: sent the 3 results of this re-run into a new run
[probara] Recorded 3 results (0 new cases, 0 unmatched) in R-2 (open): https://app.probara.net/projects/SHOP/runs/R-2
[probara] Watch mode: every re-run reports into R-2 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

- **Only a refusal moves the session.** A closed run (`409 conflict`) or a deleted one
  (`404 not_found`) refuses the re-run for good, so its results go into a new run. Any other
  failure (Probara unreachable, a `409` retried because the same report was still in flight) may
  have recorded the results after all: they are never sent twice, and the session keeps its run.
- **A run closed halfway through a re-run.** When the run refuses a re-run after part of it was
  recorded, only the results it did not record go into the new run; the rest stays in the old run,
  and the log line names both.
- **With a results file**, a refused re-run is kept in the file, which still names the refused run,
  and the next re-run reports into a new run. The log line gives the command that sends the file
  into an open run instead (`--run-ulids WEB=<ulid>` for another project). When the file cannot be
  written, the re-run goes into a new run as above.

<!-- project: watch-results-file -->

```js
reporters: ['default', ['@probara/jest-reporter', { resultsFile: 'probara-results.json' }]],
```

<!-- output: watch-results-file, scenario: watch-run-closed -->

```text
$ npx jest --watchAll
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 409 conflict: <message from Probara>. No run was created or updated
[probara] Wrote the 3 results that were not sent to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
[probara] The run R-1 of SHOP was closed: the results file /work/shop/probara-results.json keeps this re-run, but names R-1, which refuses it: send it with probara import results /work/shop/probara-results.json --run-ulid <ulid of an open run>; the next re-run reports into a new run
```

## `--watch` and `--watchAll`

Both are watch mode for the reporter. `--watch` re-runs only the tests related to changed files,
and needs git or Mercurial; `--watchAll` re-runs every test. Either way each re-run is one report
into the session's run, with the results of the tests that re-ran.

## Several Probara projects

With [`projects`](projects.md#several-probara-projects), each project gets its own run, created
with its first result in the session, and its own `Watch mode` line. A project whose tests have not
reported yet has no run until they do.

## See also

- [Run options](runs.md#closing): when runs are closed.
- [Results file](results-file.md): keeping what could not be sent.
- [Troubleshooting](troubleshooting.md#the-run-was-left-open).
