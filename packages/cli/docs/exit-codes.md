# Exit codes

The exit code says whether the **reporting** worked, not whether the tests passed. A test job keeps
its own status; the import step only fails when Probara did not get the results.

| Code | Meaning                                                                         | Retrying helps?     | Commands       |
| ---- | ------------------------------------------------------------------------------- | ------------------- | -------------- |
| 0    | Done: reported, created or closed. Also a dry run, and `PROBARA_ENABLED=false`. | —                   | all            |
| 1    | Reporting to Probara failed at runtime                                          | Often: read the log | all            |
| 2    | Usage, configuration or input error. Nothing was sent.                          | No: fix the command | all            |
| 3    | A test failed or was blocked, and `--fail-on-failed-tests` was given            | —                   | `import junit` |

When several apply, 1 and 2 win over 3: a report that failed exits 1 even if tests failed.

## What makes each code

**0**

- Every result was recorded (unmatched results included: they are warnings,
  [linking](linking.md#unmatched-results)).
- Some attachments were skipped (missing, too large): warnings too.
- The files hold no testcase: a warning, and nothing to send.
- A dry run that parsed every file, and whose results core could all convert.
- `PROBARA_ENABLED=false`: nothing is sent. The options and files are still checked: an input
  error still exits 2.
- `import results` when no file matched: nothing was left unsent.
- `run close` on a run that is already closed or aborted.

**1**

- The report failed: an error answer (401, 403, 409, 422...), or retries ran out on a network
  error, a timeout, 429 or 5xx ([network](network.md)).
- A partial report: some chunks were recorded, then one failed; the run is left open.
- Results core could not convert (`invalid`), in a real import or in a dry run. The CLI skips
  the testcases it cannot turn into a result (with a warning), so this is a bug in the CLI:
  please [report it](https://github.com/cynch-me/probara-sdk/issues).
- An attachment upload failed after its retries.
- The run could not be closed after the uploads.
- `run create` or `run close` failed.
- With `--results-file`, the results that were not sent are in that file (or its first free
  sibling): send them with [`probara import results`](commands.md#probara-import-results). A
  failed `import results` rewrites each file that failed with the results still unsent; the files
  it sent are deleted.

Running the same command again is not always harmless: a re-run of `import junit` creates a new run
unless `--run-ulid` is given, and results sent again into the same run are recorded again (the run
case keeps the last outcome). When the failed import left its run open, the last log line names
the run: for a new run, with the `--run-ulid` that imports into it; for a run given with
`--run-ulid` or `PROBARA_RUN_ULID`, with a reminder that running the same command again sends
every result into it again. A failed `run create` may have created
a run: the log says so and links the project's runs.

**2**

- An unknown option, a missing or invalid value (`--timeout soon`, `--dialect cobol`), or a
  `--token` flag.
- Not configured: no `PROBARA_API_TOKEN`, or no project.
- A configuration problem core found (`run.ulid is not a ULID`, a base URL that is not http(s)).
- No file matched the paths, or a file could not be read, is not well-formed XML, or is not a
  JUnit report. Every file is checked before anything is sent.
- `import results` with a directory, or a file that cannot be read, is not JSON, is not a results
  file of version 1, or holds settings core refuses. Every file is checked before anything is
  sent. No file matching is not an error for `import results` (exit 0).
- `run create` with `PROBARA_RUN_ULID` already set; `run close` without a run.

**3**

- `import junit --fail-on-failed-tests`, the results were sent, and at least one was `failed` or
  `blocked`. It also exits 3 with `PROBARA_ENABLED=false`, since the tests still failed. A dry run
  never exits 3.

<!-- output: import -->

```text
$ probara import junit junit.xml --fail-on-failed-tests
[probara] junit.xml: jest, 10 results
[probara] Results: 10 (7 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Recorded 10 results (10 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Exit 3: 2 results failed or blocked (--fail-on-failed-tests)
```

The last log line always explains a non-zero exit, and `--json` has the code in `exitCode`.

## Making CI pass or fail on purpose

**Report even when the tests failed.** Run the import in a step that runs after a failed test
step: `if: always()` in GitHub Actions, `when: always` in GitLab, `post { always { ... } }` in
Jenkins, `condition: always()` in Azure Pipelines, `when: always` in CircleCI, an `after-script`
in Bitbucket, and a separate step with `allow_dependency_failure` in Buildkite. Each
[CI guide](../README.md#documentation) shows it.

**Fail the job on failed tests from the import step**, when the test step itself does not fail
(it ignores its exit code, or the tests ran elsewhere):

```bash
probara import junit junit.xml --fail-on-failed-tests # exit 3
```

**Never fail the job because of reporting**:

```bash
probara import junit junit.xml || true
```

Most CIs also have a switch for one step: `continue-on-error: true` (GitHub Actions),
`allow_failure: true` (GitLab), `continueOnError: true` (Azure Pipelines).

**Tolerate a Probara outage, but not a broken command.** Exit 1 is a runtime failure; exit 2 means
the step is misconfigured and will never work. Let only 1 through:

```bash
probara import junit junit.xml || test $? -eq 1
```

## See also

- [Troubleshooting](troubleshooting.md): what to do about each failure.
- [Network](network.md): retries and timeouts before a code 1.
- [Commands](commands.md): the exit codes in each `--help`.
