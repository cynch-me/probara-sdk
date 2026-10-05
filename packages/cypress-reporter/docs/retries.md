# Retries and flaky tests

Every attempt of a test is a result of its own. A test Cypress retries sends one result per
attempt, in the order the attempts ran, each with its own status, duration, error, steps and files.
How many attempts Cypress makes is Cypress' own setting, `retries` in the Cypress config:

```js
// cypress.config.js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP' },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
    retries: { runMode: 1 },
  },
});
```

```js
// cypress/e2e/retry.cy.js
let attempts = 0;

describe('Flaky', () => {
  beforeEach(() => {
    attempts += 1;
  });

  it('passes on its retry', () => {
    if (attempts < 2) throw new Error('attempt ' + attempts + ' failed');
  });
});
```

```text
$ npx cypress run --spec cypress/e2e/retry.cy.js
[probara] Sending 2 results of 1 test (1 passed, 1 failed, 0 skipped, 0 blocked)
```

- **What Probara shows.** The run case keeps the last outcome (`passed` here), and every attempt
  stays in its history: a flaky test is a case whose history mixes failures and passes on the same
  run. The `Sending` line says it: more results than tests.
- **The attempt number.** From the second attempt on, the result carries an `attempt` parameter
  (`2`, `3`, ...), next to the `browser` every result carries. Both are parameters of the result,
  never part of the automation key
  ([configuration](configuration.md#browserasparameter)).
- **No flaky flag.** The reporter does not mark attempts as flaky: the attempts themselves are the
  evidence. What `probara import junit` keeps of a retried test is the **last** attempt alone, so a
  suite that moves from the JUnit import to this reporter gains the earlier attempts in the history
  of each flaky case, and nothing else changes
  ([migrating from the JUnit import](migrating-from-junit.md#the-deliberate-difference-in-results)).
- **Each attempt starts empty.** What the `probara.*` helpers said belongs to the attempt that said
  it: an attempt Cypress retries closes its window, so the steps, files and metadata of the next
  attempt are its own and never inherited
  ([metadata](metadata.md#what-is-different-in-a-cypress-run)).
- **Cypress' own summary** counts each test once, by its last attempt; Probara counts every
  attempt. Cypress also ends the command with its number of failed **tests**, which a retried test
  contributes to once ([statuses](statuses.md#the-exit-code-is-cypress-own)).

## A hook that fails on every attempt

A `beforeEach` that fails makes Cypress retry the test, and the two attempts are reported under two
different names: the attempt it is about to retry, under the test's own name, and the failure it
cannot get past, under the synthetic `"before each" hook for "…"` name (which is what cypress-junit
writes, so the key is the one the import gives):

```text
cypress/e2e/hooks.cy.js > Checkout never runs                          failed
cypress/e2e/hooks.cy.js > Checkout "before each" hook for "never runs" failed
```

A hook that fails **once** and passes on the retry is one test with two results under one key, like
any other retry. Both shapes are in [specs](specs.md#a-hook-that-fails).

## Screenshots of a retry

With `attachScreenshots` (on by default) each failed attempt gets the screenshot Cypress took for
it: Cypress names them `<titles joined by ' -- '> (failed)` and
`… (failed) (attempt N)` from the second attempt on, and the reporter matches each of them to the
attempt it names ([attachments](attachments.md#screenshots)).

## Keeping retries out of your numbers

To send only the last attempt, do not retry in Cypress: no option of the reporter drops attempts.
To keep failures of retried tests from counting, map them
([status mapping](statuses.md#status-mapping-and-filter)), knowing that it applies to every failure
and therefore to the retried ones too.

## See also

- [Statuses](statuses.md).
- [Steps](steps.md) and [attachments](attachments.md): what each attempt carries.
- [Migrating from the JUnit import](migrating-from-junit.md): the key contract and what changes.
