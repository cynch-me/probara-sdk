# Specs

Cypress runs one **spec** at a time, in its own Mocha reporter, and the reporter this package
registers is that reporter. What a spec does with its tests is therefore reported as Cypress does
it, and the cases where that differs from what you may expect are this page: a test a hook kept
from running, a spec Cypress could not load, a test that only exists in another spec's file because
of `it.only`, and the two files Cypress writes for you, the screenshots and the video.

## What a spec is, in a result

| Part of the spec            | What it is in the result                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| The spec file               | The file of the automation key (with `keyIncludesFile`) and the first segment of the case's suite            |
| The `describe` titles       | The rest of the case's suite path                                                                            |
| The `it` title              | The single title segment of the key, which is the full title (the describes and the title, joined by spaces) |
| A `beforeEach`/`before`     | Nothing of its own: what it did belongs to the test it runs for                                              |
| The screenshot of a failure | A file of the result of that exact attempt                                                                   |
| The video of the spec       | A file of every failed result of that spec, with `attachVideos`                                              |

A test that lives in no `describe` has the spec as its only suite, and a title of its own:

```js
// cypress/e2e/parity-root.cy.js
it('runs in the root suite', () => {
  cy.wrap(6).should('equal', 6);
});
```

```text
cypress/e2e/parity-root.cy.js > runs in the root suite
suitePath: cypress/e2e/parity-root.cy.js
```

Cypress joins the titles of a screenshot with `--`, not with the space the key joins them with,
which is why the reporter rebuilds each name from the suite stack the way Cypress does and matches
it against the paths Cypress hands it
([screenshots](#the-screenshots-of-a-failure)).

## `it.skip` and `this.skip()`

```js
// cypress/e2e/cart.cy.js
it.skip('is skipped', () => {});
```

Cypress announces a skipped test with `pending` and no `test end` at all, so the reporter takes
that announcement as the whole result and never waits for an end that never comes: the result is
**skipped**. A `this.skip()` in a `beforeEach` is the same, a `pending` of the test that is running.
The results of a spec are sent when the spec ends.

## `it.only`

```js
describe('Cart', () => {
  it.only('adds an item', () => {
    cy.get('.add').click();
  });

  it('removes an item', () => {
    cy.get('.remove').click();
  });
});
```

**Only `adds an item` is reported.** `it.only` removes the other tests from Cypress's own tree
before anything runs: they are not skipped results, and they are not in the report at all. The
reporter reports what Cypress announces, so a test Cypress never announces has nothing to report
(there is no phantom result and no warning).

The same holds for the specs `--spec` leaves out: a spec Cypress does not run reports nothing, and
nothing warns about it. With `--spec cypress/e2e/cart.cy.js`, only that spec's results are sent —
that is what a filtered run is for.

## A spec Cypress cannot run

A spec whose module scope throws while Cypress loads it still builds a reporter, and Cypress names
the failure after what happened:

```text
cypress/e2e/throws.cy.js > An uncaught error was detected outside of a test
```

It is a failed result like any other, with the error in its notes, and it is retried like any other
test when `retries.runMode` allows it (one result per attempt, as everywhere else).

A spec Cypress **cannot parse** (a syntax error) never builds a reporter at all: no test event ever
reaches it. Cypress reports the spec as one failure with no test, and the plugin turns that into
the single failed result that keeps the spec from showing green:

```text
cypress/e2e/broken.cy.js > Spec failed to run
```

Its notes say what Cypress counted (`Cypress could not run this spec: 1 failure(s), no test ran`), and
its case sits in the suite of the spec alone: no `describe` ever ran, so none is known.

## A hook that fails

A `beforeEach` (or a `before`) belongs to no test of its own: what it did belongs to the test it runs
for. Cypress reports a failing hook under a synthetic test it names after the hook and the test it
was running — `"before each" hook for "never runs"` — and that is the name the reporter reports, so
the key is the one `probara import junit` gives for the same hook
([migrating from JUnit](migrating-from-junit.md)).

**A hook that fails once and passes on the retry** is one test with two results under one key: the
failed attempt and the pass.

```text
cypress/e2e/retry.cy.js > Flaky passes on its retry: failed, passed
```

**A hook that fails on every attempt** is two failed keys, because Cypress reports the attempt it is
about to retry and the failure it could not get past:

```text
cypress/e2e/hooks.cy.js > Checkout never runs: failed
cypress/e2e/hooks.cy.js > Checkout "before each" hook for "never runs": failed
cypress/e2e/hooks.cy.js > Checkout never runs either: skipped
cypress/e2e/hooks.cy.js > Profile still runs: passed
```

Reading the four lines:

- `Checkout never runs` is the **first attempt of the test**, which failed because its hook did and
  which Cypress is about to run again.
- `Checkout "before each" hook for "never runs"` is the **failure Cypress could not get past**, named
  after the hook, in the suite of the test it was running. It is the key cypress-junit writes, so the
  import sees exactly this one.
- `Checkout never runs either` is the **second test of that describe**, which never ran at all: the
  reporter walks the suite when it ends and reports every test of it that reported no attempt as
  **skipped**. That is the one result the reporter adds and the import cannot: a test that never ran
  emits no event, so no JUnit holds it.
- `Profile still runs` is the next `describe`, which Cypress ran as usual: a failing `beforeEach`
  takes the rest of **its own** suite, never the rest of the spec.

The tests a hook kept from running are skipped, not failed: they are not known to be broken, only
known not to have run.

## The screenshots of a failure

Cypress takes a screenshot of a failed attempt by itself, and names it after the test it took it
for: the describes and the title joined with `--`, then ` (failed)`, then ` (attempt N)` from the
second attempt on. A failing hook is named after the hook, after the test it was running. A real run
of the fixture sends exactly these files:

```text
Cart -- SHOP-12 fails on purpose (failed).png
Cart -- SHOP-12 fails on purpose (failed) (attempt 2).png
Cart -- passes on the retry of its hook (failed).png
Checkout -- never runs (failed).png
Checkout -- never runs -- before each hook (failed) (attempt 2).png
Flaky -- passes on its retry (failed).png
An uncaught error was detected outside of a test (failed).png
An uncaught error was detected outside of a test (failed) (attempt 2).png
```

Each of them goes to the result of **that** attempt, as an `image/png`. With
`attachScreenshots: false` none is attached, and Cypress still takes them where it always does
([`attachScreenshots`](configuration.md#attachscreenshots)).

Two things are not attached, on purpose:

- **A screenshot Cypress took for no result of the reporter**: `cy.screenshot('my-name')` names it
  something the reporter cannot match to an attempt, so it is left out and named once at
  `PROBARA_DEBUG` ([troubleshooting](troubleshooting.md#a-screenshot-was-left-out)).
- **A screenshot of an attempt that was not failed**: only failures are attached, and the name
  carries `(failed)`.

## The video of a spec

With `video: true` in the Cypress config and `attachVideos: true` in the reporter options, the video
of a spec is attached to **every failed result of that spec** (a blocked one too), under the name of
the spec file:

```text
cart.cy.js.mp4
```

The default is off, and the cost is why: one upload per failed result of the spec, and video files
are large. A spec with no failed result sends no video, and a spec that failed with a failed result
sends one copy per failure
([`attachVideos`](configuration.md#attachvideos)).

## The spec as the suite of a case

The case a report creates sits in a suite whose path is the spec file, then the describes the test
walked:

```text
cypress/e2e/parity-suite.cy.js > Cart Checkout pays by card
suitePath: cypress/e2e/parity-suite.cy.js › Cart › Checkout
```

A test in the root suite of a spec sits in the spec alone, and so does a case created for a spec
that never ran (`Spec failed to run`). With `keyIncludesFile: false` the file leaves the suite path
too, and the describes are all of it that is left
([`keyIncludesFile`](configuration.md#keyincludesfile)).

This is the one visible difference from the JUnit import, which cannot rebuild the describes from
one title segment: it puts every case it creates in the suite of the spec alone. The **key** is the
same on both paths ([migrating from JUnit](migrating-from-junit.md)).

## What the run ends with

Cypress ends a `cypress run` with the number of its own failed **tests**, and the reporter changes
nothing of it: four failed tests end the command with `4` whatever Probara answered. A run of the
fixture whose five failing keys are listed above (a test that fails twice is one test and two
failed keys, and the hook failure is one test of its own) ends with `4`.

## See also

- [Statuses](statuses.md) for how every outcome becomes a status, and `statusMapping`/`statusFilter`.
- [Retries](retries.md) for what one result per attempt means for a flaky test.
- [Attachments](attachments.md) for what else can be attached, and the limits.
- [Configuration](configuration.md) for `attachScreenshots`, `attachVideos` and `keyIncludesFile`.
