# Run selection

A person plans a run in Probara (the cases of a release, of a test plan, the ones that failed
yesterday) and the pipeline runs exactly those tests. With `runCasesOnly`, the reporter reads the
run's cases before Vitest runs a test file, Vitest runs only the tests that belong to one of them,
and their results go into that run, which stays open.

## Quick path

1. In the job that runs a run's tests, set `PROBARA_RUN_CASES_ONLY=true` and `PROBARA_RUN_ULID` to
   the run's ULID (in Probara: the run's **Run actions** menu › **Copy run ULID**). Nothing goes
   in the Vitest config: the setup file the reporter adds to every Vitest project does the
   skipping.
2. Check the run in Probara: its cases have the results, and the run stays open for whoever planned
   it.

<!-- output: default, scenario: run-cases -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx vitest run
[probara] Ran only the tests of run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: 2 of 3 tests match its cases; 1 skipped and not reported
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (0 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

In GitHub Actions, a workflow started by hand with the run's ULID as an input:

```yaml
on:
  workflow_dispatch:
    inputs:
      run_ulid:
        description: The ULID of the Probara run to run the tests of
        required: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - name: Run the tests of a Probara run
        run: npx vitest run
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_RUN_CASES_ONLY: 'true'
          PROBARA_RUN_ULID: ${{ inputs.run_ulid }}
```

Turn it on per job, with the variables: `runCasesOnly: true` in the Vitest config turns it on in
every job, and a job without a ULID then warns and runs every test.

## Which tests belong to the run

A test belongs to the run when one of these holds, checked for each test before it runs:

| The test                                                               | Example                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Its automation key is the key of one of the run's cases                | A case the reporter or `probara import junit` created      |
| Its title or one of its `describe` titles names one of the run's cases | `test('SHOP-12 adds an item')`, `describe('SHOP-12 cart')` |

- **`probara.id()` does not count**: it runs in the test's body, after the selection. Name the case
  in a title instead ([linking](linking.md)).
- **Keys are the reporter's**: with the same [`keyIncludesFile`](linking.md#without-the-file) and
  `rootDir` as the report that linked the cases. Title ids of the projects in
  [`projects`](projects.md#several-probara-projects) count too.
- **A case of the run with no test** simply gets no result: the log counts only the tests.

In the example above the run has two cases: `SHOP-12`, named in the title of a cart test, and
`SHOP-30`, whose key is the login test's. The third test belongs to neither, so Vitest skips it,
and only the other two are sent:

<!-- sent: default, scenario: run-cases-only -->

```json
[
  { "caseDisplayId": "SHOP-12", "automationKey": "tests/cart.test.ts > cart > adds an item" },
  { "automationKey": "tests/login.test.ts > login > logs in with a valid password" }
]
```

## What is reported

| Test                                                                        | Runs | Reported                                      |
| --------------------------------------------------------------------------- | ---- | --------------------------------------------- |
| Belongs to the run                                                          | Yes  | Yes, into the run, with every attempt         |
| Belongs to the run, but `test.skip`, `test.todo` or in a skipped `describe` | No   | Yes, as skipped (a todo with the note `Todo`) |
| Belongs to no case of the run                                               | No   | No: Vitest's summary counts it as skipped     |

Vitest still loads every test file. The setup file skips a test that belongs to no case in a
`beforeEach` hook that runs before yours:

| Of a test that belongs to no case                                             | Runs                                    |
| ----------------------------------------------------------------------------- | --------------------------------------- |
| Its `beforeEach` hooks and its body                                           | No                                      |
| Its `afterEach` hooks                                                         | Yes                                     |
| The `beforeAll` and `afterAll` hooks of its file and of its `describe` blocks | Yes, even when none of their tests runs |

So write an `afterEach` that works when its `beforeEach` did not run, or return the cleanup from
the `beforeEach` itself: Vitest runs that cleanup only after a `beforeEach` that ran. When loading a
file is expensive (a database, a server), also pass Vitest a filter that leaves it out:

```bash
PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx vitest run tests/cart
```

## When it cannot select

Selection never breaks the test run: when it cannot know which tests belong to the run, every test
runs and is reported, with one warning.

| What happens                                      | The warning                                                                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `run.ulid` nor `PROBARA_RUN_ULID`              | `runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported`                                         |
| The run's cases cannot be read (404, 403...)      | `runCasesOnly: could not read the cases of the run <ULID> (<why>). Every test runs and is reported`                                                        |
| A browser project (`browser.enabled`)             | `runCasesOnly does not apply in browser mode yet: the tests of project "<name>" run and are reported (first seen in the run; repeats are logged at debug)` |
| A shard that writes a blob for `--merge-reports`  | `runCasesOnly does not apply to a sharded run with the blob reporter: every test runs, and vitest --merge-reports reports them all`                        |
| A project the reporter could not add its setup to | `runCasesOnly needs the setup file in project "<name>": its tests run and are reported (first seen in the run; repeats are logged at debug)`               |
| A project that could not take the run's cases     | `could not give project "<name>" the cases of the run (<why>): its tests all run and are reported`                                                         |
| No test matches any case of the run               | `No test matches the cases of the run <ULID>: every test was skipped, and none is reported`                                                                |

With reporting off (no token, `enabled: false`), every test runs and nothing is sent. With a
`resultsFile` too, the reporter warns that it could not read the cases
`(reporting to Probara is off)`, and the file gets every test.

The cases cannot be read, for example, when the token cannot read that run:

<!-- output: default, scenario: run-cases-refused -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx vitest run
[probara] runCasesOnly: could not read the cases of the run 01J9Z3K4M5N6P7Q8R9S0T1V2W3 (Probara answered 403 forbidden: <message from Probara>). Every test runs and is reported
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (1 new case, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

A run none of whose cases a test names or matches:

<!-- output: default, scenario: run-cases-unmatched -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx vitest run
[probara] No test matches the cases of the run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: every test was skipped, and none is reported
```

Nothing is sent then, and the run is left as it was: check that the ULID is the run's you meant.

## Setups

- **Vitest projects**: every project gets the run's cases, and the `Ran only` line counts the tests
  of all of them. A browser project is the exception above: its tests all run and are reported.
- **Shards** (`--shard`) without the `blob` reporter: each shard reads the run's cases and runs its
  part of the selected tests.
- **Shards that write a blob**: selection does not apply, since the `vitest --merge-reports` run
  would report the skipped tests too. Every test runs, and the merge run reports them all
  ([sharding](ci/sharding.md#run-selection)).
- **Watch mode**: the run's cases are read again before each re-run, so a case added to the run in
  Probara selects its test from the next re-run on ([watch mode](watch.md)).
- **One more request**: reading the cases is one `GET` before the tests start, 200 cases per page.
  It is the one read an app token can make.

## See also

- [Configuration](configuration.md#options): `runCasesOnly`.
- [Run options](runs.md#an-existing-run): reporting into an existing run.
- [Linking](linking.md): case ids in titles, and automation keys.
- [Troubleshooting](troubleshooting.md#run-selection-ran-every-test).
