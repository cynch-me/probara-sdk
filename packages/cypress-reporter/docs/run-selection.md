# Run selection

`runCasesOnly: true` (`PROBARA_RUN_CASES_ONLY`, off by default) runs **only the tests of the cases of
a run**, and reports into that run. It is how a Probara run drives the Cypress suite: pick the tests
of the run in Probara, then run Cypress with the run's ULID.

```bash
PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx cypress run
```

The run it reports into is the one it took its cases from, and it is never closed (a reused run is
never closed by a report: [run options](runs.md)). Turn the option on in the job that runs a run's
tests, not everywhere.

## What a test must match

A test belongs to the run when **either** holds:

- Its **automation key** is the key of one of the run's cases: the spec path (with
  `keyIncludesFile`) and the test's full title, the describes and the title joined by spaces
  ([linking](linking.md#automation-keys)).
- Its **title names a case of the run**, as a case id: `SHOP-12` in an `it` or in a `describe`
  title. A case id in a `describe` takes every test of it, as everywhere.

A `probara.id()` call does **not** count: it runs with the test, after the question of whether that
test runs has been answered.

Everything else is skipped by the support file, in a root `beforeEach` that asks the plugin (one
`cy.task('probara', …)` per test, which the plugin answers out of the cases it read once for the
run). A skipped test is **not reported at all**: it is counted as skipped and left out of the run.

## Both registrations, or it runs everything

| Registration                                           | What it does for the selection                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `setupNodeEvents` (`@probara/cypress-reporter/setup`)  | Reads the cases of the run **once** for the whole run, however many specs it has, and answers the browser per test |
| The support file (`@probara/cypress-reporter/support`) | Asks that question in a root `beforeEach`, and `this.skip()`s a test the answer excluded                           |

Without either one, every test runs and is reported, with one warning naming what was missing.

## What it logs

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx cypress run --spec cypress/e2e/helpers.cy.js
[probara] Ran only the tests of run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: 1 of 8 tests match its cases; 7 skipped and not reported
```

One line, written once when the run ends, in the wording of the Jest reporter: how many tests of
the run matched, and how many were skipped and not reported. The run stays open, and the results of
the tests that ran go into it.

## When it cannot select

Every fallback runs **every** test and reports it, rather than none, and says so with exactly one
warning. Each of these three is a case where it cannot:

| Warning                                                                                                                                             | Why, and what to do                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported`                                  | No run to take the cases from. Set `run.ulid` or `PROBARA_RUN_ULID`                                                              |
| `runCasesOnly: could not read the cases of the run <ULID> (<reason>). Every test runs and is reported`                                              | The run's cases could not be read: a wrong ULID, a token of another organization, Probara unreachable. The reason is in the line |
| `runCasesOnly needs the support file: require('@probara/cypress-reporter/support') in the Cypress support file, or every test runs and is reported` | The support file is missing: without it no test can be skipped                                                                   |

A fourth case is the opposite one: the selection worked and **nothing** matched.

```text
[probara] No test matches the cases of the run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: every test was skipped, and none is reported
```

Then the run has no tests of its suite: check the ULID, and that the token can read that run. A
suite whose keys were renamed after the run was created has no key match at all.

## What still runs

Cypress decides `it.skip` while the spec loads, and the selection is a `beforeEach`: so a spec with
no test of the run still runs the **module scope of its file** (the top-level code, including what
it imports and what it sets up) and the `before`/`after` hooks at the root of the file. Its tests are
skipped; its file is not skipped as a whole.

When that module scope is expensive, also pass Cypress the specs of the run's tests:

```bash
npx cypress run --spec 'cypress/e2e/{cart,checkout}.cy.js'
```

Quote the glob, as Cypress documents it, so the shell does not expand it first.

## See also

- [Configuration](configuration.md#runcasesonly): the option and its variable.
- [Linking](linking.md): what an automation key is, and case ids in titles.
- [Statuses](statuses.md): a skipped test is a skipped result, and `statusFilter: ['skipped']` is a
  blunt way to leave them out of the report too.
- [Troubleshooting](troubleshooting.md#run-selection-ran-every-test): the same warnings, with what to
  do about each.
