# Retries and flaky tests

Every attempt of a test is a result of its own. A test retried twice sends three results, in the
order they ran, each with its own status, duration, errors, steps and files.

<!-- project: retries -->

```ts
retries: 1,
```

<!-- project: retries -->

```ts
// tests/flaky.spec.ts
import { expect, test } from '@playwright/test';

test('loads the dashboard', async ({}, testInfo) => {
  // Fails the first time, passes on the retry.
  expect(testInfo.retry).toBe(1);
});
```

<!-- sent: retries -->

```json
[
  { "automationKey": "flaky.spec.ts > loads the dashboard", "status": "failed" },
  { "automationKey": "flaky.spec.ts > loads the dashboard", "status": "passed" }
]
```

<!-- output: retries -->

```text
$ npx playwright test
[probara] Sending 2 results of 1 test (1 passed, 1 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Attached 1 file to results (0 skipped, 0 failed)
```

The file is the error context Playwright wrote for the failed attempt ([attachments](attachments.md)).

- **What Probara shows.** The run case keeps the last outcome (`passed` here), and every attempt
  stays in its history: a flaky test is a case whose history mixes failures and passes on the same
  run. The count of the log says it: more results than tests.
- **No flaky flag.** The reporter does not mark attempts as flaky: the attempts themselves are the
  evidence, and Playwright's own verdict (flaky, when a retry passed) stays in Playwright's reports.
- **Each attempt starts empty.** `probara.*` metadata applies to the attempt that called it, so a
  retry that stops earlier does not inherit the metadata of the first attempt.
- **Order.** Results are sent in the order Playwright ends the attempts; since the run case keeps
  the last outcome, the final retry is the one it shows.

To send only the last attempt, filter in Playwright instead: no option of the reporter drops
attempts. To keep failures of retried tests out of your numbers, map them
([status mapping](statuses.md#status-mapping-and-filter)) knowing it applies to every failure.

## See also

- [Statuses](statuses.md).
- [Steps](steps.md) and [attachments](attachments.md): per attempt.
