# Debugging

What the reporter logs, how to see more, and how to check what would be sent without sending it.

## The log

The reporter writes to **stderr** only, every line prefixed with `[probara]`; stdout belongs to
Playwright's own reporters (`list`, `dot`...). A run that reports logs two lines:

<!-- output: default -->

```text
$ npx playwright test
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

| Line                                 | What it says                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `Sending N results of M tests (...)` | Before anything is sent: one result per attempt and case, by status after `statusMapping`, and what was left out |
| `Recorded N results (...) in R-1`    | Per run: what Probara recorded, the cases it created, the results it could not match, and the link               |
| `N results were not recorded (...)`  | The unmatched results, by reason, with their cases or keys                                                       |
| `Attached N files to results (...)`  | Uploads: attached, skipped and failed                                                                            |
| `N results were not sent: ...`       | A failed report: the reason, and the run left open                                                               |
| `Wrote ... to <file>`                | What went to the [results file](results-file.md)                                                                 |

A warning that repeats in every test (a malformed helper call, a skipped attachment) is logged the
first time, naming the test, and at debug afterwards. The token never appears in any line, even
when Probara's answer echoes it.

## `PROBARA_DEBUG`

`debug: true` (`PROBARA_DEBUG=true`) adds a line for every request (method, path, status, time)
and every retry, and says why reporting is off when it is:

```bash
PROBARA_DEBUG=true npx playwright test
```

Keep it off in normal runs: it is verbose, though it never logs the token or the bodies.

## Check what would be sent

The reporter has no dry run of its own, but a results file is one: run the tests with reporting
off and a results file, then let the CLI print what it would send. Nothing reaches Probara, and no
token is needed:

<!-- output: default, scenario: not-configured, stream: stdout -->

```text
$ PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=probara-results.json npx playwright test
[probara] Wrote 2 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ npx @probara/cli import results probara-results.json --dry-run
passed	SHOP-12	cart.spec.ts > cart > adds an item
passed	-	cart.spec.ts > cart > removes an item
Total: 2 results from 1 file (2 passed, 0 failed, 0 skipped, 0 blocked)
```

The first command logs on stderr; the dry run prints on stdout, one line per result: the status,
the case (`-` when none is named) and the automation key.
`--dry-run` never touches the file; delete it afterwards, or import it for real (a file left
there makes the next run write `probara-results-2.json`). `--json` prints the
whole document instead, each entry as Probara would receive it
([`probara import results`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-import-results)).

Use it to compare keys before a refactor or an upgrade: write one file per run, and diff the two
dry runs. Give each run its own file name and start without them: with a file already at the path,
a run writes to a sibling (`before-2.json`) and the dry run of `before.json` would show an older
run, hiding the difference.

```bash
rm -f before.json after.json
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=before.json npx playwright test
# Change the code, or upgrade the reporter, then:
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=after.json npx playwright test
npx @probara/cli import results before.json --dry-run > before.txt
npx @probara/cli import results after.json --dry-run > after.txt
diff before.txt after.txt
```

Any line that changed is a test whose key or case link changed: it would get a new case.

## Where problems show

| You see                                        | Look at                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| No `[probara]` line at all                     | [Nothing is reported](troubleshooting.md#nothing-is-reported-and-nothing-is-logged)                                |
| `... Probara reporting is off ...`             | [A configuration problem](troubleshooting.md#reporting-is-off-a-configuration-problem)                             |
| `... not sent ...`                             | [401 or 403](troubleshooting.md#probara-answers-401-or-403), [left open](troubleshooting.md#the-run-was-left-open) |
| `... not recorded (...)`                       | [Unmatched results](troubleshooting.md#results-were-not-recorded-unmatched)                                        |
| `[probara] probara.x() ...` in a test's output | [Where to call the helpers](metadata.md#where-to-call-the-helpers)                                                 |

## See also

- [Troubleshooting](troubleshooting.md).
- [Network](network.md): retries and timeouts in the log.
