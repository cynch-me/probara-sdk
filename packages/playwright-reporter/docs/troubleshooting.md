# Troubleshooting

Each entry starts from what you see, then says why and what to do. The reporter logs on stderr in
`[probara]` lines; [`PROBARA_DEBUG=true`](debugging.md) adds every request. Whatever the problem,
Playwright's exit code stays the tests' own.

## Nothing is reported, and nothing is logged

**Why.** Without a token and a project, the reporter stays off and quiet, on purpose: local runs
and fork builds send nothing. It says so only at debug:

<!-- output: default, scenario: not-configured -->

```text
$ PROBARA_DEBUG=true npx playwright test
[probara] Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it
```

**Solution.** Give the step that runs `npx playwright test` the `PROBARA_API_TOKEN` secret, and
set the project (`projectId` or `PROBARA_PROJECT`). Check that the reporter is registered in the
config Playwright uses (`reporter: [...]`), or in `--reporter` when you pass one: `--reporter`
replaces the config's reporters. With `merge-reports`, the token and the reporter belong to the
merge job ([sharding](ci/sharding.md#pattern-1-merge-the-blob-reports)).

## Reporting is off: a configuration problem

<!-- output: default -->

```text
$ PROBARA_RUN_ULID=R-12 npx playwright test
[probara] Probara reporting is off: PROBARA_RUN_ULID is not a ULID
```

**Why.** A setting has a wrong value, or only one of the token and the project is set. Each problem
is logged, naming the option or variable at fault (never its value), and nothing is sent.

**Solution.** Fix the setting the line names ([configuration](configuration.md#options)).

## Probara answers 401 or 403

<!-- output: default, scenario: unauthorized -->

```text
$ npx playwright test
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 2 results were not sent: Probara answered 401 unauthorized: <message from Probara>. No run was created or updated
```

**Why.** `401`: the token is wrong, revoked, or from another Probara (`baseUrl`). `403`: the token
cannot report to that project, or the organization is on the free plan (reporting from CI needs a
paid plan).

**Solution.** Create a new app token from the **Playwright** card ([get a token](configuration.md#get-a-token))
and update the secret; check the project code; check the organization's plan.

## The run was left open

The error line ends with `The run R-4 was left open: <url>`, or, when not even the first report
went through, `No run was created or updated`.

**Why.** A report failed after its retries (Probara unreachable, a refused report): the reports
after it are not sent, and a run that already has results stays open, so nothing looks complete
when it is not. The last line names the run.

**Solution.** Set a [results file](results-file.md): what was not sent goes there, with the run it
belongs to, and `probara import results` sends it into that run and closes it. Otherwise close the
run by hand with `npx @probara/cli run close --run-ulid <ulid>`, and run the tests again.

## Results were not recorded (unmatched)

<!-- output: default -->

```text
$ PROBARA_CREATE_MISSING_CASES=false npx playwright test
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (0 new cases, 1 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] 1 result was not recorded (case_not_found): cart.spec.ts > cart > removes an item
```

**Why.** A result names a case that does not exist (a typo in an id, a case of another project), or
matches no case while `createMissingCases` is off. Probara records the others and says which were
left out, with the reason.

**Solution.** Fix the id, create the case, or let the reporter create missing cases (the default).

## A case of another project is not sent

**Why.** A test linked to `WEB-3` while `WEB` is neither the project nor one of `projects`: the
result would land in the wrong project. One warning per project says so.

**Solution.** List the project in `projects` (`PROBARA_PROJECTS=WEB`) ([several projects](multi-project.md)).

## Every run creates new cases

**Why.** The automation keys changed: a test, `describe` or file was renamed or moved, a Playwright
project was renamed, or `rootDir` (`testDir`) moved ([what changes a key](linking.md#automation-keys)).
Running from another directory does not change keys: they are relative to Playwright's `rootDir`.

**Solution.** Link the tests to their cases with ids ([linking](linking.md)), so a rename keeps them.
Before a refactor, [compare the keys](debugging.md#check-what-would-be-sent).

## An attachment is missing

**Why.** The log names every file it skipped and why: over 32 MiB, an image over 10 MiB or 8192 px,
a refused content type, more than 20 files in one result, or a file that was gone when it
uploaded ([limits](attachments.md#limits-and-what-is-skipped)). A file attached inside a step goes
to that step, not to the result. Videos and traces only exist when `use` turns them on.

**Solution.** Keep `test-results/` until the reporter is done; lower the size of screenshots
(`fullPage: false`); attach fewer files per result.

## A helper warns that it only works while a test runs

**Why.** A `probara.*` helper was called outside a test: at the top of a file, in `beforeAll`,
`afterAll` or a worker fixture. Nothing is recorded, and the test goes on.

**Solution.** Call it in the test, `beforeEach`, `afterEach` or a test fixture
([where to call the helpers](metadata.md#where-to-call-the-helpers)).

## Probara answers 429 (too many requests)

**Why.** The organization's rate limit (60 requests per minute by default) is shared by every token
and pipeline. Attachments cost two requests per result ([rate limit](network.md#rate-limit)).

**Solution.** The reporter waits and retries on its own. For large suites, keep traces and videos
for failures only, lower `attachmentConcurrency`, or spread sharded pipelines in time.

## merge-reports sends nothing

**Why.** The reporter is not among the merge's reporters, or the merge job has no token.

**Solution.** Pass `--reporter @probara/playwright-reporter` (or a `--config` that registers it)
to `npx playwright merge-reports`, and give that job `PROBARA_API_TOKEN` and the project
([sharding](ci/sharding.md#pattern-1-merge-the-blob-reports)).

## See also

- [Debugging](debugging.md).
- [Network](network.md).
