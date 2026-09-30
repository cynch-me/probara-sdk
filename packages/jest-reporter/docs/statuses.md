# Statuses

Each attempt is sent with Jest's own verdict. `statusMapping` and `statusFilter` can change that
afterwards.

## How an attempt becomes a status

| The attempt                                                                         | Status                          |
| ----------------------------------------------------------------------------------- | ------------------------------- |
| Passed                                                                              | `passed`                        |
| Failed: an assertion, an error, a timeout, a `beforeAll` or `beforeEach` that threw | `failed`                        |
| `test.skip`, `xit`, a skipped `describe`, a test `.only` or `-t` left out           | `skipped`                       |
| `test.todo`                                                                         | `skipped`, with the note `Todo` |
| `test.failing`, and it threw as expected                                            | `passed`                        |
| `test.failing`, but it passed                                                       | `failed`                        |

The reporter never sends `blocked` on its own: map a status to it (below) when you need it.

<!-- project: statuses, exit: 1 -->

```js
// tests/statuses.test.js
test('passes', () => {});

test('fails', () => {
  expect(1 + 1).toBe(3);
});

test.skip('is skipped', () => {});

test.todo('is not written yet');

test.failing('is a known bug', () => {
  expect(0.1 + 0.2).toBe(0.3);
});
```

<!-- sent: statuses -->

```json
[
  { "automationKey": "tests/statuses.test.js > passes", "status": "passed" },
  { "automationKey": "tests/statuses.test.js > fails", "status": "failed" },
  {
    "automationKey": "tests/statuses.test.js > is not written yet",
    "status": "skipped",
    "notes": "Todo"
  },
  { "automationKey": "tests/statuses.test.js > is a known bug", "status": "passed" },
  { "automationKey": "tests/statuses.test.js > is skipped", "status": "skipped" }
]
```

- **Order.** Tests are sent in the order Jest reports them: the tests that ran and the todo tests
  as they end, then the skipped tests of the file, once it ends.
- **Errors** go in the notes of the result: every error of the attempt, with its message and
  stack, without the terminal's colors, after a [comment](metadata.md#comment) if the test wrote
  one.
- **Todo tests** are never lost: they are skipped results with the note `Todo`, so the case shows
  what is still to be written. `probara import junit` records them as passed, because jest-junit
  writes them as passing test cases ([migrating from JUnit](migrating-from-junit.md)).
- **Expected failures** are Jest's: a `test.failing` test that throws does what it should, so it
  passes, and the run stays green in Probara as it does in Jest. When the bug is fixed, the test
  passes, Jest fails it, and so does Probara, reminding you to remove `.failing`.
- **Skipped tests have no duration**: Jest does not run them. On Jest 29 they get their file's
  start time; Jest 30 gives each its own.

## A hook that fails after the tests

An `afterAll` hook that throws fails the test file after its tests passed. Jest prints the error
and fails the command; its tests stay green. So that Probara does not show the file as green
either, the reporter sends one more failed result for the file, the one jest-junit writes, with the
error in its notes:

<!-- project: after-all, exit: 1 -->

```js
// tests/cleanup.test.js
afterAll(() => {
  throw new Error('Could not drop the test database');
});

test('creates an order', () => {});
```

<!-- sent: after-all -->

```json
[
  { "automationKey": "tests/cleanup.test.js > creates an order", "status": "passed" },
  {
    "automationKey": "tests/cleanup.test.js > Test execution failure: could be caused by test hooks like 'afterAll'.",
    "status": "failed"
  }
]
```

Its key is the one `probara import junit` gives the same failure in jest-junit's report, so both
tools record it into the same case.

## A file Jest cannot run

A test file that fails before its tests exist (a syntax error, an import that throws) has no test
to report. The reporter names it in one warning, and reports the other files as usual:

<!-- project: broken, exit: 1 -->

```js
// tests/broken.test.js
const { total } = require('./missing-module');

test('adds the items', () => {
  expect(total([1, 2])).toBe(3);
});
```

<!-- project: broken -->

```js
// tests/cart.test.js
test('adds an item', () => {});
```

<!-- output: broken -->

```text
$ npx jest
[probara] Could not report tests/broken.test.js: Jest could not run it (Cannot find module './missing-module' from 'tests/broken.test.js')
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

Fix the file: Jest's own output shows the error in full.

## Status mapping and filter

`statusMapping` sends a status as another; `statusFilter` sends no result with the given statuses,
after the mapping. Both take `passed`, `failed`, `skipped` and `blocked`:

<!-- project: mapping, exit: 1 -->

```js
reporters: [
  'default',
  [
    '@probara/jest-reporter',
    { statusMapping: { failed: 'blocked' }, statusFilter: ['skipped'] },
  ],
],
```

<!-- project: mapping -->

```js
// tests/filters.test.js
test('passes', () => {});

test('fails', () => {
  expect(true).toBe(false);
});

test.todo('is not written yet');
```

<!-- output: mapping -->

```text
$ npx jest
[probara] Sending 2 results of 2 tests (1 passed, 0 failed, 0 skipped, 1 blocked); 1 left out by statusFilter
[probara] Recorded 2 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Filtered out 1 result by their status (statusFilter): not sent
```

As variables: `PROBARA_STATUS_MAPPING=failed=blocked,skipped=passed` and
`PROBARA_STATUS_FILTER=skipped,blocked`. A value that is not a status, or a status mapped twice, is
a configuration problem that turns reporting off. `statusFilter: ['skipped']` leaves out todo tests
too: they are skipped results. The mapping changes what Probara records only: Jest's exit code stays
the tests' own.

## See also

- [Retries and flaky tests](retries.md): the status of each attempt.
- [Run selection](run-selection.md): tests left out of a run are not reported at all.
- [Migrating from Qase](migrating-from-qase.md): how Qase's statuses differ.
