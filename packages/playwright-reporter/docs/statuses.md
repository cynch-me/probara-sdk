# Statuses

Each attempt is sent with Playwright's own verdict: what the attempt did compared with what the
test expected. `statusMapping` and `statusFilter` can change that afterwards.

## How an attempt becomes a status

| The attempt                                                                 | Status    |
| --------------------------------------------------------------------------- | --------- |
| Passed                                                                      | `passed`  |
| Failed: an assertion, an error, a hook or a fixture threw                   | `failed`  |
| Timed out                                                                   | `failed`  |
| Interrupted (the run stopped: `Ctrl+C`, `--max-failures`, a global timeout) | `failed`  |
| `test.skip()`, `test.fixme()`, a skipped `describe`                         | `skipped` |
| `test.fail()`, and it failed as expected                                    | `passed`  |
| `test.fail()`, but it passed                                                | `failed`  |

The reporter never sends `blocked` on its own: map a status to it (below) when you need it.

<!-- project: statuses, exit: 1 -->

```ts
// tests/statuses.spec.ts
import { expect, test } from '@playwright/test';

test('passes', async () => {});

test('fails', async () => {
  expect(1 + 1).toBe(3);
});

test('is skipped on CI', async () => {
  test.skip(true, 'Needs the payment sandbox');
});

test.fixme('is not written yet', async () => {});

test('is a known bug', async () => {
  test.fail(true, 'SHOP-99: totals round down');
  expect(0.1 + 0.2).toBe(0.3);
});
```

<!-- sent: statuses -->

```json
[
  { "automationKey": "statuses.spec.ts > passes", "status": "passed" },
  { "automationKey": "statuses.spec.ts > fails", "status": "failed" },
  {
    "automationKey": "statuses.spec.ts > is skipped on CI",
    "status": "skipped",
    "notes": "Skipped: Needs the payment sandbox"
  },
  { "automationKey": "statuses.spec.ts > is not written yet", "status": "skipped" },
  { "automationKey": "statuses.spec.ts > is a known bug", "status": "passed" }
]
```

- **Errors** go in the notes of the result: every error of the attempt, with its message and
  stack, after a [comment](metadata.md#comment) if the test wrote one.
- **Skip reasons** go in the notes as `Skipped: <reason>`, the same line `probara import junit`
  writes, from `test.skip(condition, reason)` or `test.fixme(condition, reason)`.
- **Expected failures** are Playwright's: a `test.fail()` test that fails does what it should, so it
  passes, and the run stays green in Probara as it does in Playwright. When the bug is fixed, the
  test passes, Playwright fails it, and so does Probara, reminding you to remove `test.fail()`.
- **Timeouts** keep Playwright's message (`Test timeout of 30000ms exceeded.`) in the notes.

## Status mapping and filter

`statusMapping` sends a status as another; `statusFilter` sends no result with the given statuses,
after the mapping. Both take `passed`, `failed`, `skipped` and `blocked`:

<!-- project: mapping, exit: 1 -->

```ts
reporter: [
  [
    '@probara/playwright-reporter',
    { statusMapping: { failed: 'blocked' }, statusFilter: ['skipped'] },
  ],
],
```

<!-- project: mapping -->

```ts
// tests/filters.spec.ts
import { expect, test } from '@playwright/test';

test('passes', async () => {});

test('fails', async () => {
  expect(true).toBe(false);
});

test('is skipped', async () => {
  test.skip();
});
```

<!-- output: mapping -->

```text
$ npx playwright test
[probara] Sending 2 results of 2 tests (1 passed, 0 failed, 0 skipped, 1 blocked); 1 left out by statusFilter
[probara] Recorded 2 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Filtered out 1 result by their status (statusFilter): not sent
[probara] Attached 1 file to results (0 skipped, 0 failed)
```

As variables: `PROBARA_STATUS_MAPPING=failed=blocked,skipped=passed` and
`PROBARA_STATUS_FILTER=skipped,blocked`. A value that is not a status, or a status mapped twice, is a
configuration problem that turns reporting off. The mapping changes what Probara
records only: Playwright's exit code stays the tests' own.

## See also

- [Retries and flaky tests](retries.md): the status of each attempt.
- [Migrating from Qase](migrating-from-qase.md#what-is-different-and-why): how Qase's statuses differ.
