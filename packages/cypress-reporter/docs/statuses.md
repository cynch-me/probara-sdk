# Statuses

Each attempt is sent with Cypress' own verdict: what Cypress reports, the reporter sends.
`statusMapping` and `statusFilter` can change that afterwards, and they change only what Probara
records.

## How an attempt becomes a status

| What Cypress reports                                                                                                    | Status                            |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| A test that passed (`pass`)                                                                                             | `passed`                          |
| A test that failed (`fail`), whatever threw: an assertion, an error, a timeout                                          | `failed`                          |
| An attempt Cypress is about to run again (`retry`), the attempt a failed `beforeEach` or a failure of the test made     | `failed`                          |
| An `it.skip` or a `this.skip()` (`pending`)                                                                             | `skipped`                         |
| A test a failing `beforeEach` kept from running                                                                         | `skipped`                         |
| A failing `beforeEach` or `before`, which Cypress reports as `"before each" hook for "…"`                               | `failed`, under that name         |
| A spec whose body throws while Cypress loads it, which Cypress names `An uncaught error was detected outside of a test` | `failed`                          |
| A spec Cypress cannot parse, which builds no reporter at all                                                            | `failed`, as `Spec failed to run` |

The reporter never sends `blocked` on its own: map a status to it (below) when you need it.

The four statuses are `passed`, `failed`, `skipped` and `blocked`. A result carries the status, the
duration and start time Cypress reported, and the error of a failed attempt in its notes, with its
message and stack and without the terminal's colors.

A real run over the fixture's `cart`, `hooks`, `broken` and `throws` specs (`retries.runMode: 1`,
so a test that never passes has two attempts) sends, for the specs that produce failures:

```text
cypress/e2e/cart.cy.js > Cart adds an item                                            passed
cypress/e2e/cart.cy.js > Cart SHOP-12 fails on purpose                               failed, failed
cypress/e2e/cart.cy.js > Cart is skipped                                             skipped
cypress/e2e/cart.cy.js > Checkout WEB-3 keeps another project id in its title        passed
cypress/e2e/cart.cy.js > Checkout pays by card                                       passed
cypress/e2e/hooks.cy.js > Checkout never runs                                        failed
cypress/e2e/hooks.cy.js > Checkout "before each" hook for "never runs"               failed
cypress/e2e/hooks.cy.js > Checkout never runs either                                 skipped
cypress/e2e/hooks.cy.js > Profile still runs                                         passed
cypress/e2e/broken.cy.js > Spec failed to run                                        failed
cypress/e2e/throws.cy.js > An uncaught error was detected outside of a test          failed, failed
```

Three lines of that list are worth reading twice:

- **`Checkout never runs` and the hook failure are two results of one test.** A `beforeEach` that
  fails on every attempt makes Cypress report the attempt it is about to retry (under the test's
  own name) and the failure it cannot get past (under the synthetic name
  `"before each" hook for "never runs"`, which is what cypress-junit writes for it, so the key is
  the one the import gives).
- **`Checkout never runs either` is skipped**, not failed: it never ran, and the reporter walks the
  suite when it ends to report every test of it that reported no attempt
  ([specs](specs.md#a-hook-that-fails)).
- **`Spec failed to run` is one result for a whole spec.** Cypress cannot parse it, so it builds no
  reporter and no test event ever arrives; the plugin turns the failure Cypress counted into this
  one failed result, whose notes read `Cypress could not run this spec: 1 failure(s), no test ran`,
  so a broken spec never shows green
  ([specs](specs.md#a-spec-cypress-cannot-run)).

## The exit code is Cypress' own

Cypress ends a `cypress run` with the number of its own failed **tests**, and reporting changes
nothing of it: the five-spec run these keys come from ends with `4`, even though it sent five
failing keys (a test that fails twice is one test, and the hook failure is a test of its own). What
Probara recorded — every attempt, a mapped status, a filtered-out result, a run that could not be
sent at all — never reaches the exit code.

## Status mapping and filter

`statusMapping` sends a status as another; `statusFilter` sends no result with the given statuses,
**after** the mapping. Both take `passed`, `failed`, `skipped` and `blocked`.

```json
{ "statusMapping": { "failed": "blocked" }, "statusFilter": ["failed"] }
```

```js
// cypress.config.js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', statusMapping: { failed: 'blocked' } },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

```text
$ npx cypress run --spec cypress/e2e/cart.cy.js
[probara] Sending 5 results of 5 tests (3 passed, 0 failed, 1 skipped, 1 blocked)
```

With `statusFilter: ['failed']` as well, the failed attempt is not sent at all, and the `Sending`
line says how many were left out:

```text
[probara] Sending 4 results of 4 tests (3 passed, 0 failed, 1 skipped, 0 blocked); 1 left out by statusFilter
[probara] Filtered out 1 result by their status (statusFilter): not sent
```

Both count in the line the plugin writes once, when the run ends
([troubleshooting](troubleshooting.md#results-were-left-out-on-purpose)). Cypress still fails: with
`statusFilter` on, the command above still ends with `1`.

As variables: `PROBARA_STATUS_MAPPING=failed=blocked,skipped=passed` and
`PROBARA_STATUS_FILTER=skipped,blocked`. A value that is not a status, or a status mapped twice, is
a configuration problem that turns reporting off
([configuration](configuration.md#status-mapping-and-filter)).

Two things to decide with a filter on:

- **`skipped` leaves out a lot.** Every `it.skip`, every test a failing hook kept from running, and
  (with the run selection) every test the support file skipped is a skipped result
  ([run selection](run-selection.md)). Filter the failed ones, not the skipped ones, unless a
  skipped result is noise in your run.
- **`blocked` is how a failure that is not the test's own looks.** A `beforeEach` that fails is a
  failed result named as a hook; map `failed` to `blocked` to tell those apart from the failures of
  the tests themselves.

## See also

- [Specs](specs.md): hooks, skipped tests, specs Cypress cannot run, and the video of a spec.
- [Retries and flaky tests](retries.md): one result per attempt, and the run case that keeps the
  last outcome.
- [Configuration](configuration.md#status-mapping-and-filter): every option.
- [Troubleshooting](troubleshooting.md#results-were-left-out-on-purpose): what the `Sending` line
  counts.
