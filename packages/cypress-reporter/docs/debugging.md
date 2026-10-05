# Debugging

What the reporter logs, how to see more, and how to check what would be sent without sending it.

## The log

The reporter and its plugin write to **stdout**, every line prefixed with `[probara]`, among
Cypress's own output. A `cypress run` that reports logs two lines:

```text
$ npx cypress run
[probara] Sending 5 results of 4 tests (3 passed, 2 failed, 0 skipped, 0 blocked)
[probara] Recorded 5 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

With the plugin registered, everything is sent at the end of the run (`after:run`), so these lines
come after the last spec, before Cypress's `(Run Finished)` table; a warning about something inside a spec is logged when that spec ends
([two processes, one run](troubleshooting.md#two-processes-one-run)). Every line, its level and
what to do about it is listed in
[troubleshooting](troubleshooting.md#every-line-the-reporter-logs).

A warning that repeats in every test (a malformed `probara.*` call, a skipped attachment) is logged
the first time, naming where it was first seen, and at debug afterwards. The token never appears in
any line, even when Probara's answer echoes it.

## `PROBARA_DEBUG`

`debug: true` (`PROBARA_DEBUG=true`) adds a line for every request (method, path, status, time)
and every retry, the repeats of warnings, and says why reporting is off when it is:

```bash
PROBARA_DEBUG=true npx cypress run
```

Keep it off in normal runs: it is verbose, though it never logs the token or the bodies.

## Check what would be sent

The reporter has no dry run of its own, but a results file is one: run the tests with reporting
off and a results file, then let the CLI print what it would send. Nothing reaches Probara, and no
token is needed:

```text
$ PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=probara-results.json npx cypress run
[probara] Wrote 3 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ npx @probara/cli import results probara-results.json --dry-run
passed	SHOP-12	cypress/e2e/cart.cy.js > Cart adds an item
passed	-	cypress/e2e/cart.cy.js > Cart removes an item
passed	-	cypress/e2e/login.cy.js > Login logs in with a valid password
Total: 3 results from 1 file (3 passed, 0 failed, 0 skipped, 0 blocked)
```

The dry run prints one line per result, in the order the results were written: the status, the
case (`-` when none is named) and the automation key. `--dry-run` never touches the file; delete
it afterwards, or import it for real (a file left there makes the next run write
`probara-results-2.json`). `--json` prints the whole document instead, each entry as Probara would
receive it
([`probara import results`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-import-results)).

Use it to compare keys before a refactor, an upgrade or a switch of `keyIncludesFile`: write one
file per run, and diff the two dry runs. Give each run its own file name and start without them:
with a file already at the path, a run writes to a sibling (`before-2.json`) and the dry run of
`before.json` would show an older run, hiding the difference.

```bash
rm -f before.json after.json
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=before.json npx cypress run
# Change the code, or upgrade the reporter, then:
PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=after.json npx cypress run
npx @probara/cli import results before.json --dry-run > before.txt
npx @probara/cli import results after.json --dry-run > after.txt
diff before.txt after.txt
```

Any line that changed is a test whose key or case link changed: it would get a new case.

## Where problems show

| You see                                        | Look at                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| No `[probara]` line at all                     | [Nothing is reported](troubleshooting.md#nothing-is-reported-and-nothing-is-logged)                                      |
| `... Probara reporting is off ...`             | [A configuration problem](troubleshooting.md#reporting-is-off-a-configuration-problem)                                   |
| `... not sent ...`                             | [401 or 403](troubleshooting.md#probara-answers-401-or-403), [the run stays open](troubleshooting.md#the-run-stays-open) |
| `... not recorded (...)`                       | [Unmatched results](troubleshooting.md#results-were-not-recorded-unmatched)                                              |
| Results, but no screenshots and no `probara.*` | [The plugin is missing](troubleshooting.md#results-are-reported-but-the-screenshots-the-video-and-the-helpers-are-not)   |
| Any other warning                              | [Troubleshooting](troubleshooting.md), which lists every line the reporter logs                                          |

## See also

- [Troubleshooting](troubleshooting.md).
- [Network](network.md): retries and timeouts in the log.
