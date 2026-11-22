# Exit codes

The exit code says whether the **reporting** worked, not whether the tests passed. A test job keeps
its own status; the import step only fails when Probara did not get the results.

| Code | Meaning                                                                                                             | Retrying helps?     | Commands                          |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------- |
| 0    | Done: reported, created or closed. Also a dry run, and `PROBARA_ENABLED=false`.                                     | —                   | all                               |
| 1    | Reporting to Probara failed at runtime                                                                              | Often: read the log | all                               |
| 2    | Usage, configuration or input error. Nothing was sent.                                                              | No: fix the command | all                               |
| 3    | A test failed or was blocked, or an unhandled error was left out (Vitest 5), and `--fail-on-failed-tests` was given | —                   | `import junit`, `import cucumber` |
| 4    | The Snap build has changes its review did not accept, and `--fail-on-changes` was given                             | No: review them     | `snap wait`                       |

When several apply, 1 and 2 win over 3: a report that failed exits 1 even if tests failed or an
error was left out.

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
- `snap finalize`: the build is finalized, or already was.
- `snap upload`: every screenshot is in the build.
- `snap wait`: the build is complete: every screenshot is compared. With `--fail-on-changes`, its
  changes, if any, are accepted too.
- `sync gherkin`: Probara answered the sync. With `--dry-run`, the outcome was computed and nothing
  was written.
- `vis` commands: done. `vis create` uploaded and finalized the Vis, and printed it.

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
- `snap finalize`: Probara refused it (404 when no build has the name and the nonce, 409 while no
  machine has sent its screenshots or when the build failed, 422 for a build with a shard total),
  or retries ran out. Finalizing again is safe.
- `snap upload`: a `.png` file that is not a PNG (nothing was sent); or Probara refused the build or an upload (409 past the plan's monthly screenshots), or retries
  ran out.
- `snap wait`: the build ended with an error or expired, or `--max-wait` passed first; no build
  matched; or Probara refused the request, or retries ran out. Waiting again is safe.
- `sync gherkin`: Probara refused the sync (an error answer, such as 422 for a `@probara:` tag that
  names an unknown case), or retries ran out. A refused sync writes nothing: fix the cause and run
  it again.
- `vis` commands: Probara refused the call (an app token gets 403, a Vis that does not exist 404),
  or retries ran out. A `vis create` that fails after the Vis was created deletes it again; when
  even that fails, the log says so, and Probara deletes the pending Vis seven days after its
  creation. `vis delete` exits 1 when the answer to its question is not `y`.
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
- `snap finalize` without a nonce, when the CI names none either.
- `snap upload` without a directory, or with one that is missing or holds no `.png` file; a
  `--viewport` or `--shard` that does not parse; no full commit or no branch known (set
  `PROBARA_COMMIT` and `PROBARA_BRANCH` outside a CI).
- `snap wait` with a `--build` that is not a ULID, or with nothing that names the build: no
  `--build`, no nonce, and no nonce or commit the CI gives.
- `import cucumber`: a file that is not a Cucumber JSON report, or a feature file it names that does
  not parse. Every file is checked before anything is sent.
- `sync gherkin`: a glob that matches no file, a file that does not parse or is outside
  `--root-dir`, a step keyword that is not English, a Feature or scenario without a name, two
  scenarios with one automation key (both lines are named), more than 1,000 scenarios or 20
  arguments. Every file is checked before anything is sent, so nothing is archived.
- `vis` commands: an id that is neither a ULID nor a display ID such as `VIS-12`. `vis create`: a
  file that is not an MP4, WebM, PNG, JPEG or WebP, a screenshot over 10 MiB, a video whose length
  is not in the file and no `--duration-ms`, a bad `--metadata` pair, or a `--playwright-trace`
  that cannot be read (nothing is sent, the video included). `vis delete` without `--yes` when
  stdin is not a terminal.

**3**

- `import junit` or `import cucumber --fail-on-failed-tests`, the results were sent, and at least one was `failed` or
  `blocked`, or Vitest 5 left out an unhandled error (see [Vitest](junit.md#vitest)). It also exits
  3 with `PROBARA_ENABLED=false`, for the same reasons. A dry run never exits 3.

**4**

- `snap wait --fail-on-changes`, the build is complete, and it has changes its review did not
  accept: none reviewed yet, or rejected. Accept them in Probara, then run the job again. Codes 1
  and 2 win.

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

**Fail the job on failed tests, or on an unhandled error left out, from the import step**, when the
test step itself does not fail (it ignores its exit code, or the tests ran elsewhere):

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
