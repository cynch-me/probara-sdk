# Migrating from the JUnit import

Without this reporter, a Cypress suite reaches Probara as JUnit XML: Cypress's built-in `junit`
reporter ([Cypress's reporter docs](https://docs.cypress.io/app/tooling/reporters)), which is the
[mocha-junit-reporter](https://www.npmjs.com/package/mocha-junit-reporter) Cypress bundles (2.2.0 in
Cypress 16.1.1), or its fork [cypress-junit](https://www.npmjs.com/package/cypress-junit) writes one
file per spec, and the CLI imports them:

```js
// cypress.config.js
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    reporter: 'junit', // or 'cypress-junit'
    reporterOptions: { mochaFile: 'reports/cypress-[hash].xml', includePending: true },
  },
});
```

```bash
npx cypress run
npx @probara/cli import junit 'reports/cypress-*.xml'
```

Both write XML of the same shape with their default options, and the import reads both as its
`cypress-junit` dialect, with the same keys: a run of the same specs through each, on Cypress
16.1.1, gave the same `probara import junit --dry-run` output, key for key.

**`@probara/cypress-reporter` gives every test the same automation key**, so a project can switch
and keep every case and its history. This page is what changes and what does not; the
[CLI's JUnit mapping](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/junit.md#cypress)
is the reference for the import path.

## The key contract

Both paths read the same two things out of a Cypress test:

| Part      | What it is                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| The file  | The spec path relative to the project root, as the `file` attribute of the `Root Suite` of the report        |
| The title | **One** segment: the full title of the test, its `describe` titles and its own title joined by single spaces |

```js
// cypress/e2e/cart.cy.js
describe('PRB-12 Cart', () => {
  it('adds an item', () => {
    cy.get('.add').click();
  });
});
```

```text
cypress/e2e/cart.cy.js > Cart adds an item
```

The case id in the `describe` (`PRB-12`) links the test to that case and is **not** part of the key,
so a renamed describe keeps its case. The describes cannot be split back out of one title segment:
that is why both paths use one segment, and why a key cannot tell `a b` › `c` from `a` › `b c`.

**Run the import from the project root**, where `cypress/` lives (or pass `--root-dir`): the import
makes the spec path relative to the directory it runs in, and the reporter makes it relative to
Cypress's `projectRoot`.

This is not a promise: `test/parity.test.ts` runs **the same suite twice in a real `cypress run`**,
once with this reporter and once with Cypress's `junit` reporter, and compares the keys Probara
received. Over a suite of every shape the two paths can disagree on (describes two and three levels
deep, `it.skip`, a failure with a stack, a thrown error, a hook that fails once, a hook that fails
always, case ids in a `describe` and in an `it`, a title holding `--`, a unicode title, and a second
spec whose tests live in the root suite), every key of the import is a key of the reporter.

## The one difference in the case's suite

Where a **created** case sits is the only visible difference, and it never changes a key:

| Path         | `suitePath` of a case it creates                                                 |
| ------------ | -------------------------------------------------------------------------------- |
| The reporter | The spec path and the describes the test walked: `cypress/e2e/cart.cy.js › Cart` |
| The import   | The spec path alone: `cypress/e2e/cart.cy.js`                                    |

A JUnit report holds one title segment per testcase, so the import cannot rebuild the describes and
puts every case it creates under the spec. An existing case never moves.

## The deliberate difference in results

The import reads one testcase per test: the **last** attempt Cypress left in the report. The
reporter sends **one result per attempt**, as every reporter of this package does:

| Cypress                                   | The reporter                                                            | The import                     |
| ----------------------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| A test that fails, then passes on a retry | Two results of one case: the failed attempt, then the pass              | One result: the pass           |
| A test that fails on every attempt        | One result per attempt                                                  | One result: the last failure   |
| A `beforeEach` that fails once            | `failed`, then `passed`                                                 | `passed`                       |
| A hook that fails on every attempt        | The retried attempt of the test, **and** the hook failure Cypress names | The hook failure only          |
| The tests that hook kept from running     | **skipped**, one result each                                            | Nothing: they emitted no event |

Everything else about a result is the same: the status, the error in the notes (the stack, without
terminal colors), the duration and the start time. The reporter adds two parameters the JUnit has
nowhere to put: the browser (`browser`, with `browserAsParameter`) and the attempt number
(`attempt`, from the second attempt on).

## Steps

1. **Add the reporter** in place of the JUnit one: Cypress takes one `reporter`. Keep the XML of an
   earlier run to compare with, or list both reporters in
   [cypress-multi-reporters](configuration.md#registration) for a while:

   ```js
   const { defineConfig } = require('cypress');
   const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

   module.exports = defineConfig({
     e2e: {
       reporter: '@probara/cypress-reporter',
       reporterOptions: { projectId: 'SHOP' },
       setupNodeEvents(on, config) {
         return probaraNodeEvents(on, config);
       },
     },
   });
   ```

   ```js
   // cypress/support/e2e.js
   import '@probara/cypress-reporter/support';
   ```

2. **Compare what each path would send.** The import has a dry run; the reporter has no dry run of
   its own, but a results file is one: run with reporting off and let the CLI print what it would
   send. Nothing reaches Probara, and no token is needed.

   ```bash
   PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=probara-results.json npx cypress run
   npx @probara/cli import results 'probara-results*.json' --dry-run
   ```

   ```text
   $ PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=probara-results.json npx cypress run
   [probara] Wrote 3 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
   $ npx @probara/cli import results 'probara-results*.json' --dry-run
   passed	SHOP-12	cypress/e2e/cart.cy.js > Cart adds an item
   ```

   The import's own dry run says the same for the XML it wrote
   (`reports/cypress-1a2b3c4d5e6f7a8b.xml: cypress-junit, 13 results`). A results file is also
   what keeps the run alive when Probara refuses the token
   ([results file](results-file.md)).

3. **If the paths disagree**, it is `keyIncludesFile`: a JUnit report written without the `file`
   attribute of its root suite (or with the file outside the project root) produces keys without the
   spec path, and `keyIncludesFile: false` gives those
   ([configuration](configuration.md#keyincludesfile)).

4. **Stop writing the XML** when the runs are green: remove the JUnit reporter from `reporter` and
   `reporterOptions`, and the import step from the pipeline. A test that names no case in its titles
   keeps its case through both paths; a renamed spec or describe does not (the key is the spec path
   and the full title, as everywhere: [linking](linking.md#automation-keys)).

## When the import does not recognize your files

The CLI reads a report as `cypress-junit` only when **all** of these hold, so no other tool's report
loses its own reading:

| Condition                                                               | Why                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| A `<testsuites>` root named `Mocha Tests`                               | The title both reporters give the root of a spec             |
| Every testcase's `classname` is the end of its `name`, or equals it     | The classname is the title and the name the full title       |
| Exactly one testsuite has a `file`                                      | Both write one file per report: the `Root Suite` of the spec |
| That file is a Cypress spec (`cypress/` in the path, or a `.cy.*` name) | What keeps a mocha-junit report of another tool out          |
| At least one testcase                                                   | A report with no tests names no tool                         |

A project that renamed the root (`testsuitesTitle` in `reporterOptions`), or a spec outside
`cypress/` with a name that is not `*.cy.js`, `*.cy.jsx`, `*.cy.ts` or `*.cy.tsx`, is read as
`generic` instead. Pass the dialect by hand:

```bash
npx @probara/cli import junit 'reports/cypress-*.xml' --dialect cypress-junit
```

`--dialect` applies to every file of the command, and a wrong dialect changes every key: import
files of different tools with one command each.

## Two settings worth keeping on the import side

If the XML stays for a while (another reporter, another tool that reads it), keep them: without
`[hash]` in `mochaFile`, the JUnit reporter **rewrites the file for every spec**, so one name keeps
only the last spec; and without `includePending`, an `it.skip` is left out of the report
entirely instead of reported as skipped. The reporter needs neither: it sees every event of every
spec, and reports a skipped test as skipped.

## See also

- [Linking](linking.md): what a key is made of, and what changes it.
- [Specs](specs.md): hooks, skipped tests, specs Cypress cannot run.
- [Retries](retries.md): one result per attempt, and what Probara shows for a flaky test.
- [Troubleshooting](troubleshooting.md): every line the reporter logs.
