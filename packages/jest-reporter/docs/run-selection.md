# Run selection

A person plans a run in Probara (the cases of a release, of a test plan, the ones that failed
yesterday) and the pipeline runs exactly those tests. With `runCasesOnly`, the reporter reads the
run's cases before Jest starts its tests, Jest runs only the tests that belong to one of them, and
their results go into that run, which stays open.

## Quick path

1. Add the reporter's setup file to the Jest config, once. It skips the tests of no case of the
   run; without the variables below it does nothing.

   <!-- project: selection -->

   ```js
   reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
   setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
   ```

2. In the job that runs a run's tests, set `PROBARA_RUN_CASES_ONLY=true` and `PROBARA_RUN_ULID` to
   the run's ULID (in Probara: the run's **Run actions** menu › **Copy run ULID**).
3. Check the run in Probara: its cases have the results, and the run stays open for whoever planned
   it.

<!-- output: selection, scenario: run-cases -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx jest
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
        run: npx jest
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_RUN_CASES_ONLY: 'true'
          PROBARA_RUN_ULID: ${{ inputs.run_ulid }}
```

Turn it on per job, with the variables: `runCasesOnly: true` in the Jest config turns it on in
every job, and a job without a ULID then warns and runs every test.

## Which tests belong to the run

A test belongs to the run when one of these holds, checked for each test before it runs:

| The test                                                               | Example                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Its automation key is the key of one of the run's cases                | A case the reporter or `probara import junit` created      |
| Its title or one of its `describe` titles names one of the run's cases | `test('SHOP-12 adds an item')`, `describe('SHOP-12 cart')` |

- **`probara.id()` does not count**: it runs with the test, after the selection. Name the case in a
  title instead ([linking](linking.md)).
- **Keys are the reporter's**: with the same [`keyIncludesFile`](configuration.md#keyincludesfile)
  and `rootDir` as the report that linked the cases. Title ids of the projects in
  [`projects`](projects.md#several-probara-projects) count too.
- **A case of the run with no test** simply gets no result: the log counts only the tests.

In the example above the run has two cases: `SHOP-12`, named in the title of a cart test, and
`SHOP-30`, whose key is the login test's. The third test belongs to neither, so Jest skips it, and
only the other two are sent:

<!-- sent: selection, scenario: run-cases-only -->

```json
[
  { "caseDisplayId": "SHOP-12", "automationKey": "tests/cart.test.js > cart adds an item" },
  { "automationKey": "tests/login.test.js > login logs in with a valid password" }
]
```

## What is reported

| Test                                                                     | Runs | Reported                                      |
| ------------------------------------------------------------------------ | ---- | --------------------------------------------- |
| Belongs to the run                                                       | Yes  | Yes, into the run, with every attempt         |
| Belongs to the run, but `test.skip`, `test.todo` or a skipped `describe` | No   | Yes, as skipped (a todo with the note `Todo`) |
| Belongs to no case of the run                                            | No   | No: Jest's summary counts it as skipped       |

Tests are skipped once Jest loaded their file, from a root `beforeAll` hook the setup file adds, so
a file with no test of the run still runs its module scope and its root `beforeAll` and `afterAll`
hooks (the hooks of a `describe` with no test of the run are skipped with it). When that is
expensive (a database, a browser), also pass Jest a path filter that leaves such files out:

```bash
PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx jest tests/cart
```

## When it cannot select

Selection never breaks the test run: when it cannot know which tests belong to the run, every test
runs and is reported, with one warning.

| What happens                                  | The warning                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| No `run.ulid` nor `PROBARA_RUN_ULID`          | `runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported`                          |
| The run's cases cannot be read (404, 403...)  | `runCasesOnly: could not read the cases of the run <ULID> (<why>). Every test runs and is reported`                                         |
| A test file ran without the setup file        | `runCasesOnly needs the setup file: add setupFilesAfterEnv: [...] to the Jest config. Every test of a file without it runs and is reported` |
| The setup file could not skip tests in a file | `runCasesOnly: the setup file could not skip the tests of a file that match no case of the run (<why>). ...`                                |
| No test matches any case of the run           | `No test matches the cases of the run <ULID>: every test was skipped, and none is reported`                                                 |

The cases cannot be read, for example, when the token cannot read that run:

<!-- output: selection, scenario: run-cases-refused -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx jest
[probara] runCasesOnly: could not read the cases of the run 01J9Z3K4M5N6P7Q8R9S0T1V2W3 (Probara answered 403 forbidden: <message from Probara>). Every test runs and is reported
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (1 new case, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

A config without the setup file:

<!-- project: selection-without-setup -->

```js
reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
```

<!-- project: selection-without-setup -->

```js
// tests/cart.test.js
test('SHOP-12 adds an item', () => {});

test('removes an item', () => {});
```

<!-- output: selection-without-setup, scenario: run-cases-only -->

```text
$ npx jest
[probara] runCasesOnly needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config. Every test of a file without it runs and is reported (first seen in tests/cart.test.js; repeats are logged at debug)
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

A run none of whose cases a test names or matches:

<!-- output: selection, scenario: run-cases-unmatched -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx jest
[probara] No test matches the cases of the run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: every test was skipped, and none is reported
```

Nothing is sent then, and the run is left as it was: check that the ULID is the run's you meant.

The setup file cannot skip tests in a file when the file runs under another test runner than
jest-circus (`testRunner: 'jest-jasmine2'`), or when its selection failed. Such a file runs and
reports every test, and the `Ran only` line leaves it out of its count.

## Setups

- **`injectGlobals: false`** works: the setup file takes Jest's hooks from `@jest/globals`.
- **Jest `projects`**: give every project the setup file. A test whose title holds
  [`{displayName}`](projects.md#displayname-in-a-title) runs in every project (the setup file cannot
  know the project's name), and is reported only where its name, with the project's, belongs to the
  run; the `Ran only` line counts the others apart, as `ran and not reported`.
- **Shards** (`--shard`): each shard reads the run's cases and runs its part of the selected tests.
- **Watch mode**: the run's cases are read again before each re-run.
- **One more request**: reading the cases is one `GET` before the tests start, 200 cases per page
  ([network](network.md)). It is the one read an app token can make.

## See also

- [Configuration](configuration.md#runcasesonly): `runCasesOnly`.
- [Run options](runs.md#an-existing-run): reporting into an existing run.
- [Troubleshooting](troubleshooting.md#run-selection-ran-every-test).
