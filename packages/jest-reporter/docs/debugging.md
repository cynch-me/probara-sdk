# Debugging

What the reporter logs, how to see more, and how to check what would be sent without sending it.

## The log

The reporter writes to **stderr** only, every line prefixed with `[probara]`; the rest of the
terminal belongs to Jest's own reporters (`default`, `summary`...). A run that
reports logs two lines:

<!-- output: default -->

```text
$ npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

| Line                                                     | What it says                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Sending N results of M tests (...)`                     | Before anything is sent: one result per attempt and case, by status after `statusMapping`, and what was left out          |
| `Recorded N results (...) in R-1`                        | Per run: what Probara recorded, the cases it created, the results it could not match, and the link                        |
| `N results were not recorded (...)`                      | The unmatched results, by reason, with their cases or keys                                                                |
| `Attached N files to results (...)`                      | Uploads: attached, skipped and failed                                                                                     |
| `N results were not sent: ...`                           | A failed report: the reason, and the run left open                                                                        |
| `Wrote ... to <file>`                                    | What went to the [results file](results-file.md)                                                                          |
| `Ran only the tests of run <ULID>: ...`                  | [Run selection](run-selection.md): how many tests matched the run's cases, and how many were skipped and left out         |
| `Watch mode: every re-run reports into R-1 of SHOP, ...` | [Watch mode](watch.md): the one run of the session, which stays open, and the command that closes it                      |
| `Could not report <file>: Jest could not run it (...)`   | A test file that failed to load (a syntax error, a failing import): it has no tests to report ([statuses](statuses.md))   |
| `Probara reporting is off: ...`                          | A configuration problem: nothing is sent ([troubleshooting](troubleshooting.md#reporting-is-off-a-configuration-problem)) |

A warning that repeats in every test (a malformed `probara.*` call, a skipped attachment, a test
file without the setup file) is logged the first time, naming where it was first seen, and at debug
afterwards:

```text
[probara] captureOutput needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config (first seen in tests/checkout.test.js; repeats are logged at debug)
```

The token never appears in any line, even when Probara's answer echoes it.

## `PROBARA_DEBUG`

`debug: true` (`PROBARA_DEBUG=true`) adds a line for every request (method, path, status, time)
and every retry, the repeats of warnings, and says why reporting is off when it is:

```bash
PROBARA_DEBUG=true npx jest
```

Keep it off in normal runs: it is verbose, though it never logs the token or the bodies.

## Check what would be sent

The reporter has no dry run of its own, but a results file is one: run the tests with reporting
off and a results file, then let the CLI print what it would send. Nothing reaches Probara, and no
token is needed:

<!-- output: default, scenario: not-configured, stream: stdout -->

```text
$ PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=probara-results.json npx jest --runInBand
[probara] Wrote 3 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ npx @probara/cli import results probara-results.json --dry-run
passed	SHOP-12	tests/cart.test.js > cart adds an item
passed	-	tests/cart.test.js > cart removes an item
passed	-	tests/login.test.js > login logs in with a valid password
Total: 3 results from 1 file (3 passed, 0 failed, 0 skipped, 0 blocked)
```

The first command logs on stderr; the dry run prints on stdout, one line per result, in the order
the results were written (`--runInBand` keeps it the same from run to run): the status, the case
(`-` when none is named) and the automation key. `--dry-run` never touches the file;
delete it afterwards, or import it for real (a file left there makes the next run write
`probara-results-2.json`). `--json` prints the whole document instead, each entry as Probara would
receive it
([`probara import results`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-import-results)).

Use it to compare keys before a refactor, an upgrade or a switch of `keyIncludesFile`: write one
file per run, and diff the two dry runs. Give each run its own file name and start without them:
with a file already at the path, a run writes to a sibling (`before-2.json`) and the dry run of
`before.json` would show an older run, hiding the difference.

```bash
rm -f before.json after.json
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=before.json npx jest
# Change the code, or upgrade the reporter, then:
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=after.json npx jest
npx @probara/cli import results before.json --dry-run > before.txt
npx @probara/cli import results after.json --dry-run > after.txt
diff before.txt after.txt
```

Any line that changed is a test whose key or case link changed: it would get a new case.

## Where problems show

| You see                                    | Look at                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| No `[probara]` line at all                 | [Nothing is reported](troubleshooting.md#nothing-is-reported-and-nothing-is-logged)                                |
| `... Probara reporting is off ...`         | [A configuration problem](troubleshooting.md#reporting-is-off-a-configuration-problem)                             |
| `... not sent ...`                         | [401 or 403](troubleshooting.md#probara-answers-401-or-403), [left open](troubleshooting.md#the-run-was-left-open) |
| `... not recorded (...)`                   | [Unmatched results](troubleshooting.md#results-were-not-recorded-unmatched)                                        |
| `probara.x() only works while a test runs` | [A helper warns](troubleshooting.md#a-helper-warns-that-it-only-works-while-a-test-runs)                           |
| Any other warning                          | [Troubleshooting](troubleshooting.md), which lists every line the reporter logs                                    |

## See also

- [Troubleshooting](troubleshooting.md).
- [Network](network.md): retries and timeouts in the log.
