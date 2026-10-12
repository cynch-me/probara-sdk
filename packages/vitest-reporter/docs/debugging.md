# Debugging

The reporter logs `[probara]` lines on stderr. `PROBARA_DEBUG=true` adds every request, and a
results file with the CLI's dry run shows what a run would send, without sending it.

## The log

The reporter writes to **stderr** only, through Vitest's own logger, every line prefixed with
`[probara]`. Stdout stays Vitest's: a reporter that prints JSON there (`--reporter=json`) never gets
a line of the reporter's. A run that reports logs two lines:

<!-- output: default -->

```text
$ npx vitest run
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
| `Sharded run with the blob reporter: ...`                | A shard that writes a blob: it sends nothing, and `vitest --merge-reports` reports its results                            |
| `Probara reporting is off: ...`                          | A configuration problem: nothing is sent ([troubleshooting](troubleshooting.md#reporting-is-off-a-configuration-problem)) |

## Warnings

A warning that would repeat is logged once, the first time; with `PROBARA_DEBUG`, the reporter's
log also shows the repeats. Where it comes from decides where it shows and how it ends:

| Warning about                                                   | Logged                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A call or a file of a test, or the tests of the run             | Once per run, ending `(first seen in the run; repeats are logged at debug)`     |
| One result as it is sent (a skipped attachment, a dropped step) | Once per run, ending `(first seen in "<test>"...; repeats are logged at debug)` |
| A `probara.*` call where no test runs, or that no test can own  | In the test file's output (`stderr \| tests/...`), once per test file           |
| The setup of the run (an unknown option, a project)             | Once, when Vitest starts                                                        |

Two tests that attach the same missing file, for example:

<!-- project: warning-once -->

```ts
// tests/checkout.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('pays by card', async () => {
  await probara.attach({ name: 'receipt', path: 'receipt.txt' });
});

test('pays by transfer', async () => {
  await probara.attach({ name: 'receipt', path: 'receipt.txt' });
});
```

<!-- output: warning-once -->

```text
$ npx vitest run
[probara] probara.attach() did not attach "receipt": it does not exist (first seen in the run; repeats are logged at debug)
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

The token never appears in any line, even when Probara's answer echoes it.

## `PROBARA_DEBUG`

`debug: true` (`PROBARA_DEBUG=true`) adds a line for every request and every attempt of it, the
repeats of warnings, and says why reporting is off when it is:

<!-- output: default -->

```text
$ PROBARA_DEBUG=true npx vitest run
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Sending report 4f8d2c1a-9b3e-4c5d-8e7f-0a1b2c3d4e5f (attempt 1 of 5)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

The id after `report` is the request's `Idempotency-Key` ([network](network.md#idempotency)). Keep
debug off in normal runs: it is verbose, though it never logs the token or the bodies.

## Check what would be sent

The reporter has no dry run of its own, but a results file is one: run the tests with reporting
off and a results file, then let the CLI print what it would send. Nothing reaches Probara, and no
token is needed:

<!-- output: default, scenario: not-configured, stream: stdout -->

```text
$ PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=probara-results.json npx vitest run --no-file-parallelism
[probara] Wrote 3 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ npx @probara/cli import results probara-results.json --dry-run
passed	SHOP-12	tests/cart.test.ts > cart > adds an item
passed	-	tests/cart.test.ts > cart > removes an item
passed	-	tests/login.test.ts > login > logs in with a valid password
Total: 3 results from 1 file (3 passed, 0 failed, 0 skipped, 0 blocked)
```

The first command logs on stderr; the dry run prints on stdout, one line per result, in the order
the results were written (`--no-file-parallelism` keeps it the same from run to run): the status,
the case (`-` when none is named) and the automation key. `--dry-run` never touches the file;
delete it afterwards, or import it for real (a file left there makes the next run write
`probara-results-2.json`). `--json` prints the whole document instead, each entry as Probara would
receive it
([`probara import results`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-import-results)).

Use it to compare keys before a refactor, an upgrade of Vitest or of the reporter, or a switch of
`keyIncludesFile`: write one file per run, and diff the two dry runs. Give each run its own file
name and start without them: with a file already at the path, a run writes to a sibling
(`before-2.json`) and the dry run of `before.json` would show an older run, hiding the difference.

```bash
rm -f before.json after.json
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=before.json npx vitest run --no-file-parallelism
# Change the code, or upgrade Vitest or the reporter, then:
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=after.json npx vitest run --no-file-parallelism
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

## What the reporter never does to the run

- **It never fails the run.** Whatever goes wrong while reporting is a `[probara]` line, and the
  exit code of `vitest` is the one the tests give: a failed report or a refused token leaves it as
  it is.
- **It never changes a test's outcome.** The setup file the reporter adds records each attempt
  without throwing into the test, and a `probara.*` call that cannot be recorded is a warning, never
  an error of the test. The only tests it skips are those outside the run of
  [`runCasesOnly`](run-selection.md), when you turn it on.
- **It never writes to stdout**, so a reporter that prints there keeps its output clean.

## See also

- [Troubleshooting](troubleshooting.md).
- [Network](network.md): retries and timeouts in the log.
