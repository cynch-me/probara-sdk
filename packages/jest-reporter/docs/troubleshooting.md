# Troubleshooting

Each entry starts from what you see, then says why and what to do. The reporter logs on stderr in
`[probara]` lines; [`PROBARA_DEBUG=true`](debugging.md) adds every request. Whatever the problem,
Jest's exit code stays the tests' own. The [last section](#every-line-the-reporter-logs) lists
every line the reporter logs.

## Nothing is reported, and nothing is logged

**Why.** Without a token and a project, the reporter stays off and quiet, on purpose: local runs and
fork builds send nothing. It says so only at debug:

<!-- output: default, scenario: not-configured -->

```text
$ PROBARA_DEBUG=true npx jest
[probara] Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it
```

**Solution.** Give the step that runs `jest` the `PROBARA_API_TOKEN` secret, and set the project
(`projectId` or `PROBARA_PROJECT`). Check that the reporter is in the `reporters` of the config
Jest uses: `--reporters` on the command line replaces the config's reporters, and a `reporters`
key inside one of Jest's `projects` is ignored (register it at the top level).

## Reporting is off: a configuration problem

<!-- output: default -->

```text
$ PROBARA_RUN_ULID=R-12 npx jest
[probara] Probara reporting is off: PROBARA_RUN_ULID is not a ULID
```

**Why.** A setting has a wrong value, or only one of the token and the project is set. Each problem
is logged, naming the option or variable at fault (never its value), and nothing is sent.

**Solution.** Fix the setting the line names ([configuration](configuration.md#options)).

## Probara answers 401 or 403

<!-- output: default, scenario: unauthorized -->

```text
$ npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 401 unauthorized: <message from Probara>. No run was created or updated
```

**Why.** `401`: the token is wrong, revoked, or from another Probara (`baseUrl`). `403`: the token
cannot report to that project, or the organization is on the free plan (reporting from CI needs a
paid plan).

**Solution.** Create a new app token from the **Jest** card
([get a token](configuration.md#get-a-token)) and update the secret; check the project code; check
the organization's plan.

## The run was left open

The error line ends with `The run R-4 was left open: <url>`, or, when not even the first report
went through, `No run was created or updated`.

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
$ PROBARA_CREATE_MISSING_CASES=false npx jest --runInBand
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (0 new cases, 2 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] 2 results were not recorded (case_not_found): tests/cart.test.js > cart removes an item; tests/login.test.js > login logs in with a valid password
```

**Why.** A result names a case that does not exist (a typo in an id, a case of another project), or
matches no case while `createMissingCases` is off. Probara records the others and says which were
left out, with the reason.

**Solution.** Fix the id, create the case, or let the reporter create missing cases (the default).

## Every run creates new cases

**Why.** The automation keys changed: a test, `describe` or file was renamed or moved, `jest` runs
from another directory than before (keys are relative to it), or `keyIncludesFile` changed
([what changes a key](linking.md#automation-keys)). Coming from `probara import junit`, the
jest-junit report may have been written without the file attribute, or with other templates.

**Solution.** Name the cases in the titles ([linking](linking.md)), so a rename keeps them. Set
`rootDir` when `jest` runs from different directories. Before a refactor,
[compare the keys](debugging.md#check-what-would-be-sent); coming from the JUnit import, see
[migrating from JUnit](migrating-from-junit.md).

## A test file is not reported

<!-- project: broken, exit: 1, reports: none -->

```js
// tests/totals.test.js
const { total } = require('../src/totals');

test('adds the items', () => {
  expect(total([1, 2])).toBe(3);
});
```

<!-- output: broken -->

```text
$ npx jest
[probara] Could not report tests/totals.test.js: Jest could not run it (Cannot find module '../src/totals' from 'tests/totals.test.js')
```

**Why.** Jest could not run the file (a syntax error, an import that throws, a missing module): it
has no tests to report. The reason in parentheses is the first line of Jest's error.

**Solution.** Fix the file; Jest's own output above the `[probara]` lines shows the whole error. An
`afterAll` hook that throws is different: its tests are reported, with one more failed result
([statuses](statuses.md#a-hook-that-fails-after-the-tests)).

## A helper warns that it only works while a test runs

**Why.** A `probara.*` helper was called outside a test: at the top of a file, in a `describe` body,
`beforeAll` or `afterAll`. Nothing is recorded, and the test goes on.

**Solution.** Call it in the test, `beforeEach` or `afterEach`
([where to call the helpers](metadata.md#where-to-call-the-helpers)).

## The helpers record nothing

| You see                                                              | Why, and what to do                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `probara.* needs jest-circus, Jest's default test runner: ...`       | The config sets `testRunner` to another runner (`jest-jasmine2`). Remove it: jest-circus is Jest's default        |
| No warning, and no steps, files or metadata in one test file         | The file mocks `fs` (`jest.mock('fs')`), which the helpers write with. Mock the modules your code imports instead |
| No warning, and nothing in any file                                  | Reporting is off (no token, `enabled: false`): the helpers do nothing, and `probara.step()` still runs its body   |
| `The probara.* helpers are off: could not create their channel: ...` | The system's temporary directory is not writable. Point `TMPDIR` at a writable folder                             |

## A test lost its steps or files

<!-- project: same-name -->

```js
// tests/prices.test.js
const { probara } = require('@probara/jest-reporter');

test.each([1, 2])('rounds the total', (items) => {
  probara.parameters({ items });
});
```

<!-- output: same-name -->

```text
$ npx jest
[probara] Several tests of one file have the same full name and attempt: what the probara.* helpers said about them is left out (first seen in tests/prices.test.js › rounds the total; repeats are logged at debug)
[probara] Sending 2 results of 1 test (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

Both rows are sent, into one case, without their parameters.

**Why.** The reporter matches what the helpers said to an attempt by its test file, its full name
(the `describe` titles and the title, joined by spaces) and its attempt number. When that is not
enough to tell two attempts apart, it leaves their details out rather than give them to the wrong
test:

- **Two tests of one file with the same full name**: a `test.each` title without a placeholder (as
  above), the same title twice, or `a b` › `c` next to `a` › `b c`.
- **A file two Jest projects ran at the same moment**: the log says
  `Several Jest projects ran this file at once` ([Jest projects](projects.md#jest-projects)).
- **A retried `test.concurrent` test on Jest 30.0 to 30.4**: the calls of its retries go to its
  first attempt ([retries](retries.md#when-retries-run)).

**Solution.** Give every test of a file its own name (`test.each` placeholders: `%s`, `$name`), give
Jest projects their own files, or upgrade Jest to 30.5.

## Run selection ran every test

**Why.** With `runCasesOnly`, the reporter could not tell which tests belong to the run, so every
test ran and was reported, rather than none. One warning says why: no `PROBARA_RUN_ULID`, the run's
cases could not be read (a wrong ULID, a token of another organization), the setup file is missing
from the Jest config (or from one of its `projects`), or it could not skip tests in a file (another
`testRunner`).

**Solution.** Follow the warning ([when it cannot select](run-selection.md#when-it-cannot-select)).
When every test was skipped instead, no test belongs to the run: check the ULID, and that the tests
name the run's cases or have their keys.

## captureOutput attaches nothing

**Why.** The setup file is missing (one warning says so), or the output is of a kind it does not
capture: `process.stdout.write`, `console.table` and the like, `test.concurrent` tests, a console
the test mocked, or output outside a test ([console output](attachments.md#console-output)).

**Solution.** Add `setupFilesAfterEnv: ['@probara/jest-reporter/setup']` to the config (to every
Jest project), and log with `console.log`, `info`, `debug`, `warn` or `error` inside the test.

## An attachment is missing

**Why.** The log names every file it skipped and why: over 32 MiB, an image over 10 MiB or 8192 px, a
refused content type, more than 20 files in one result, or a file `probara.attach()` could not read
when it was called ([limits](attachments.md#limits-and-what-is-skipped)). A file attached inside a
step goes to that step, not to the result.

**Solution.** Attach a file that exists when you call `probara.attach()` (it is copied at once), keep
files under the limits, and attach fewer files per result.

## Probara answers 429 (too many requests)

**Why.** The organization's rate limit (60 requests per minute by default) is shared by every token
and pipeline. Attachments cost two requests per result ([rate limit](network.md#rate-limit)).

**Solution.** The reporter waits and retries on its own. For large suites, attach less, lower
`attachmentConcurrency`, or spread sharded pipelines in time.

## Every line the reporter logs

The reporter's own lines, besides those of the reporting library it shares with the Playwright
reporter and the CLI (`Sending`, `Recorded`, `not sent`, `Wrote`, `Attached`, `Probara warned`):

| Line                                                                                                           | Level | Page                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `Ignored the unknown option "<name>" of @probara/jest-reporter`                                                | warn  | [Configuration](configuration.md#options): a typo in an option name                           |
| `Probara reporting is off: the reporter could not start: <reason>`                                             | error | Report it: the reporter never throws into Jest, and says why it stopped                       |
| `Could not report <file>: Jest could not run it (<reason>)`                                                    | warn  | [A test file is not reported](#a-test-file-is-not-reported)                                   |
| `captureOutput needs the setup file: ...`                                                                      | warn  | [captureOutput attaches nothing](#captureoutput-attaches-nothing)                             |
| `runCasesOnly needs the setup file: ...`                                                                       | warn  | [Run selection ran every test](#run-selection-ran-every-test)                                 |
| `runCasesOnly needs the run whose tests to run: ...`                                                           | warn  | [Run selection ran every test](#run-selection-ran-every-test)                                 |
| `runCasesOnly: could not read the cases of the run <ULID> (<reason>). ...`                                     | warn  | [Run selection ran every test](#run-selection-ran-every-test)                                 |
| `runCasesOnly: the setup file could not skip the tests of a file ... (<reason>). ...`                          | warn  | [Run selection ran every test](#run-selection-ran-every-test)                                 |
| `Ran only the tests of run <ULID>: <k> of <m> tests match its cases; ...`                                      | info  | [Run selection](run-selection.md)                                                             |
| `No test matches the cases of the run <ULID>: ...`                                                             | warn  | [Run selection ran every test](#run-selection-ran-every-test)                                 |
| `Watch mode: every re-run reports into <run> of <project>, which stays open: ...`                              | info  | [Watch mode](watch.md)                                                                        |
| `The run <run> of <project> was closed: ...` (or `deleted`)                                                    | info  | [Watch mode](watch.md#when-the-run-is-closed-during-the-session)                              |
| `Several Jest projects ran this file at once: ...`                                                             | warn  | [A test lost its steps or files](#a-test-lost-its-steps-or-files)                             |
| `Several tests of one file have the same full name and attempt: ...`                                           | warn  | [A test lost its steps or files](#a-test-lost-its-steps-or-files)                             |
| `The probara.* helpers are off: could not create their channel: <reason>`                                      | error | [The helpers record nothing](#the-helpers-record-nothing)                                     |
| `probara.<helper>() only works while a test runs (...)`                                                        | warn  | [Where to call the helpers](metadata.md#where-to-call-the-helpers)                            |
| `probara.* needs jest-circus, Jest's default test runner: ...`                                                 | warn  | [The helpers record nothing](#the-helpers-record-nothing)                                     |
| `probara.<helper>() takes ...`, `probara.attach() could not attach "<name>": <reason>`                         | warn  | [Metadata](metadata.md), [attachments](attachments.md): a wrong argument; the call is ignored |
| `Dropped the issues of probara.issue(): no issueUrlTemplate turns their ids into links`                        | warn  | [Links](links.md#probaraissue-and-issueurltemplate)                                           |
| `Could not report an attempt of "<test>": <reason>`, `Could not follow ...`, `Could not finish reporting: ...` | error | Report it: an attempt the reporter could not read is lost, and the run goes on                |

A warning that repeats in every test is logged the first time, with
`(first seen in <file or test>; repeats are logged at debug)`, and at debug afterwards. The token
never appears in any line, even when Probara's answer echoes it. Report a problem at
[github.com/cynch-me/probara-sdk/issues](https://github.com/cynch-me/probara-sdk/issues), with the
`[probara]` lines of a run with `PROBARA_DEBUG=true`.

## See also

- [Debugging](debugging.md).
- [Network](network.md).
