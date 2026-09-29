# Troubleshooting

Each entry starts from what you see, then says why and what to do. The last log line of a failed
command always names the cause, and [`--dry-run`](#check-what-would-be-sent-with---dry-run) shows
what would be sent without sending it.

## No JUnit file matched

<!-- output: import -->

```text
$ probara import junit "reports/*.json"
[probara] No file matched reports/*.json
[probara] No JUnit file matched reports/*.json. Run "probara import junit --help" for usage.
```

**Why.** No path, directory or glob matched a file (exit 2). The usual causes:

- The tests wrote the report somewhere else, or not at all (check the test step's log).
- The glob was not quoted, and the shell expanded it before `probara` saw it. bash without
  `globstar` reads `**` as `*`, so `reports/**/*.xml` misses deeper folders; zsh stops with `no
matches found` before running the command.
- The import runs in another directory, or in another CI job without the files.

**Solution.** Quote globs, and let `probara` expand them. A directory works too: every `*.xml`
beneath it is read.

```bash
probara import junit "reports/**/*.xml"
probara import junit reports
```

A pattern that matches nothing next to one that matches is only a warning.

## A file is not well-formed XML, or not a JUnit report

<!-- output: import -->

```text
$ probara import junit broken.xml junit.xml
[probara] broken.xml: not well-formed XML (line 1, column 58: Expected closing tag 'testcase' (opened in line 1, col 36) instead of closing ta…)
[probara] Nothing was sent: 1 file could not be imported. Fix it or leave it out.
```

**Why.** Every file is parsed before anything is sent, so one bad file sends nothing (exit 2). A
test process that crashed or was killed while writing its report leaves a truncated file; a glob
may also match an XML file that is not a report (`pom.xml`, a config).

**Solution.** Narrow the pattern to the reports (`reports/**/TEST-*.xml`), or fix the test step
so it finishes writing. XML entities declared in a DTD are left as written, never expanded.

## Probara is not configured

<!-- output: not-configured -->

```text
$ probara import junit junit.xml
[probara] Probara is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT (or pass --project)
[probara] Nothing was sent.
```

**Why.** The CLI needs a token and a project. Without them it exits 2 rather than quietly doing
nothing, so a job that lost its secret is noticed.

**Solution.** Set `PROBARA_API_TOKEN` from your CI's secret store, and `PROBARA_PROJECT` (or
`--project`). To run without reporting on purpose, set `PROBARA_ENABLED=false`.

## Fork pull requests fail with exit 2

<!-- output: no-token -->

```text
$ probara import junit junit.xml
[probara] PROBARA_API_TOKEN is not set: the API token is only read from the environment
[probara] Nothing was sent.
```

**Why.** CI systems do not give secrets to builds of pull requests from forks, so the token is
empty there.

**Solution.** Turn reporting off when the token is missing: `PROBARA_ENABLED=false` makes the
import exit 0 without sending anything. Each [CI guide](../README.md#documentation) shows how, for
example in GitHub Actions:

```yaml
env:
  PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
```

Do not work around it by giving secrets to fork builds: anyone could open a pull request that
prints them.

## Probara answers 401 or 403

<!-- output: unauthorized -->

```text
$ probara import junit junit.xml
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] 10 results were not sent: Probara answered 401 unauthorized: <message from Probara>. No run was created or updated
[probara] Exit 1: reporting to Probara failed (the report failed)
```

**Why.** `401 unauthorized`: the token is wrong, revoked or expired, or it belongs to another
Probara than the base URL (the log prints the base URL). `403 forbidden`: the token works, but its
user may not do this. A report records results and can create cases, so it needs permission to
execute runs and to write test cases (a viewer cannot).

**Solution.** Create a new API key, update the CI secret, and check that its user has a role that
can run tests in the project. Look for stray spaces or quotes in the secret. These errors are not
retried: retrying would not help.

## Probara answers 429 Too many requests

<!-- output: rate-limited -->

```text
$ probara import junit junit.xml
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Report attempt 1 of 5 got 429; retrying in 2000 ms
[probara] Recorded 10 results (10 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

**Why.** The organization's API rate limit (60 requests per minute by default) is shared by every
job using its tokens. A 429 is retried after its `Retry-After`; the command fails (exit 1) only
when the retries run out. Attachments cost the most requests: at least 2 per result with files.

**Solution.** Most of the time, nothing: the retry handles it. If imports keep failing: lower
`--attachment-concurrency` to 1, pass `--no-attachments` or skip `--attach-output`, raise
`--max-retries` (up to 10), and avoid many parallel jobs importing at the same moment (import
shards once, [sharding](ci/sharding.md#pattern-1-collect-every-shard-and-import-once)).

## Probara answers 409 with `api_result_limit_exceeded`

**Why.** Every recorded result counts toward the organization's API result quota. When it is used
up, Probara refuses the report and writes nothing (exit 1).

**Solution.** Check the organization's plan and usage in Probara. Retrying will not help until
the quota allows more results.

## Results come back unmatched

The log says `N results were not recorded (<reason>): <examples>`, and the summary line counts
them (`Recorded 0 results (0 new cases, 10 unmatched)`): see
[the example](linking.md#turning-case-creation-off).

**Why.** Probara found no case to record the result on. The reason in the parentheses says why:
`case_not_found`, `invalid_display_id` or `case_archived` ([the reasons](linking.md#unmatched-results)).
Unmatched results do not fail the step (exit 0).

**Solution.**

- `case_not_found` with an id: the case number does not exist in the project; fix the id in the
  test. Without an id: case creation is off (`--no-create-missing-cases`), so the test needs an id
  or an existing case with its key.
- `invalid_display_id`: the id is not of this project, for example `OTHER-12` in a
  `probara_case` property while reporting into `SHOP`.
- `case_archived`: the case was archived. Restore it, or remove the id from the test.

`--json` lists every unmatched result in `summary.unmatched`, with its key or id.

## A renamed test created a duplicate case

**Why.** A test without a case id is matched by its automation key, and the key comes from the
names: renaming the test, its describe or class, its file (Jest with `file`, Playwright) or its
package gives a new key, so a new case ([what changes a key](linking.md#what-keeps-a-key-and-what-changes-it)).

**Solution.** Put the old case's id in the renamed test (`SHOP-12 adds an item`, or a
`probara_case` property) and import again: the result lands on the old case. Then archive the
duplicate in Probara. To avoid it next time, add ids to tests whose history matters before you
rename them, and keep report settings that shape names (jest-junit's file attribute, Surefire's
phrased names, gotestsum's classname) the same.

## Times are off by a few hours

**Why.** The report's timestamps have no time zone, and the import runs in another zone than the
tests did. A timestamp without an offset is read as the local time of the machine that runs the
import (Jest is the exception: jest-junit writes UTC, and the CLI knows it).

**Solution.** Import on the machine that ran the tests, or give the import the tests' zone:

```bash
TZ=UTC probara import junit junit.xml
```

## Attachments are skipped

<!-- output: dry-run-log -->

```text
$ probara import junit attachments/cart.xml --dry-run
[probara] attachments/cart.xml: attachment "logs/cart.log" of "checkout.CartTest > shows the cart" was not found
[probara] attachments/cart.xml: generic, 1 result
[probara] Results: 1 (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Dry run: nothing was sent
```

**Why and solution.**

- **Not found**: relative paths are read next to the XML file, then in the current directory. Run
  the import from the directory the tests ran in, or keep the attachment folder next to the
  report when you move it between CI jobs.
- **Too large or too many**: files over 32 MiB, images over 10 MiB or 8192 px, and files after the
  20th of a result are skipped ([limits](attachments.md#limits)). Shrink them, or attach fewer.
- **Playwright body attachments** never reach the XML: attach a file with a `path` instead
  ([Playwright](junit.md#playwright)).
- **`--no-attachments` or `PROBARA_UPLOAD_ATTACHMENTS=false`** is set somewhere.

Skipped files are warnings (exit 0). A failed upload is exit 1.

## The run was left open

**Why.** A run stays open when:

- a report failed or was partial (the log says `The run R-1 was left open: <url>`);
- `--no-close-run` or `PROBARA_CLOSE_RUN=false` was set;
- the import reused a run (`--run-ulid` or `PROBARA_RUN_ULID`): an existing run stays open unless
  `--close-run` is given, so shards do not close it for each other;
- the final `probara run close` of a sharded pipeline did not run (it must run even when shards
  fail).

**Solution.** Close it once everything is in:

```bash
probara run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

Closing a run that is already closed is fine (exit 0).

## Only part of the results arrived

<!-- output: partial -->

```text
$ probara import junit junit.xml --chunk-size 5
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Report attempt 1 of 5 got 503; retrying in 1002 ms
[probara] Report attempt 2 of 5 got 503; retrying in 2050 ms
[probara] Report attempt 3 of 5 got 503; retrying in 4353 ms
[probara] Report attempt 4 of 5 got 503; retrying in 9465 ms
[probara] Recorded 5 results (5 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
[probara] 5 results were not sent: Probara answered 503 internal_error: <message from Probara>. The run R-1 was left open: https://app.probara.net/projects/SHOP/runs/R-1
[probara] Exit 1: reporting to Probara failed (the report was partial)
[probara] The run R-1 (https://app.probara.net/projects/SHOP/runs/R-1) is still open: --run-ulid <ULID> imports into it instead of a new run
```

**Why.** Results go out in chunks of `--chunk-size` (500 by default), one after another. When one
chunk fails after its retries, the later ones are not sent: sending them out of order would
change which outcome a run case keeps. The run is left open, and the command exits 1.

**Solution.** Import into the same run again, once Probara answers:

```bash
probara import junit junit.xml --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3 --close-run
```

The results that were already recorded are recorded a second time; the run case keeps the last
outcome, which is the same.

## A Go package has fewer tests than expected

**Why.** A panic ends the test binary: the tests of that package that had not run yet are not in
the report. A parent test with subtests is also left out, unless it failed on its own
([gotestsum](junit.md#go-with-gotestsum)).

**Solution.** Fix the panic; the next run reports the missing tests.

## Check what would be sent with `--dry-run`

`--dry-run` parses the files, resolves the configuration and prints one line per result (status,
linked case, automation key) on stdout, then a total. It sends nothing and needs no token; with a
project it links ids like a real import would.

<!-- output: dry-run-project -->

```text
$ probara import junit reports/go.xml --dry-run
[probara] reports/go.xml: gotestsum, 13 results
[probara] Results: 13 (8 passed, 3 failed, 2 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
failed	-	example.com/probarafixture/auth > TestRejectsAWrongPassword
failed	-	example.com/probarafixture/auth > TestLogin > failing_subtest
skipped	-	example.com/probarafixture/auth > TestSupportsSSO
skipped	-	example.com/probarafixture/auth > TestLogin > skipped_subtest
passed	-	example.com/probarafixture/auth > TestPRB12LogsInWithAValidPassword
passed	-	example.com/probarafixture/auth > TestLogin > PRB-12_logs_in_with_a_valid_password
passed	-	example.com/probarafixture/auth > TestLogin > session > refresh_renews_the_token_before_expiry
passed	-	example.com/probarafixture/auth > TestLogin > accepts_café_and_ñandú
passed	-	example.com/probarafixture/auth > TestUsernameLength > alice
passed	-	example.com/probarafixture/auth > TestUsernameLength > bob
passed	-	example.com/probarafixture/auth > TestPrintsToStdoutAndStderr
failed	-	example.com/probarafixture/billing > TestCrashesOnAnUnexpectedPanic
passed	-	example.com/probarafixture/billing > TestChargesTheCard
Total: 13 results from 1 file (8 passed, 3 failed, 2 skipped, 0 blocked)
[probara] Dry run: nothing was sent
```

More in [debugging](debugging.md).

## See also

- [Exit codes](exit-codes.md).
- [Debugging](debugging.md): `--debug`, `--json`.
- [Network](network.md): retries, timeouts, proxies.
