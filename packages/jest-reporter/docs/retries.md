# Retries and flaky tests

Every attempt of a test is a result of its own. A test that `jest.retryTimes(2)` retries twice
sends three results, in the order they ran, each with its own status, duration, error, steps and
files.

<!-- project: retries -->

```js
// tests/dashboard.test.js
jest.retryTimes(1);

let attempts = 0;

test('loads the dashboard', () => {
  attempts += 1;
  // Fails the first time, passes on the retry.
  expect(attempts).toBe(2);
});
```

<!-- sent: retries -->

```json
[
  { "automationKey": "tests/dashboard.test.js > loads the dashboard", "status": "failed" },
  { "automationKey": "tests/dashboard.test.js > loads the dashboard", "status": "passed" }
]
```

<!-- output: retries -->

```text
$ npx jest
[probara] Sending 2 results of 1 test (1 passed, 1 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

- **What Probara shows.** The run case keeps the last outcome (`passed` here), and every attempt
  stays in its history: a flaky test is a case whose history mixes failures and passes on the same
  run. The count of the log says it: more results than tests.
- **No flaky flag.** The reporter does not mark attempts as flaky: the attempts themselves are the
  evidence. `jest-junit` and `probara import junit` keep only the last attempt of a retried test.
- **Each attempt starts empty.** `probara.*` calls apply to the attempt that made them, so a retry
  that stops earlier does not inherit the steps, files or metadata of the first attempt.
- **Jest's summary** counts the test once, by its last attempt; Probara counts every attempt.

## When retries run

By default Jest retries the failed tests of a file after the file's other tests; Jest 30's
`jest.retryTimes(n, { retryImmediately: true })` retries each one right away. Either way each
attempt is sent as it ends, so the order of attempts of one test is always the order they ran, and
the run case keeps the outcome of the last one.

| Jest                                            | What changes for Probara                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `retryImmediately`, `waitBeforeRetry` (Jest 30) | When each attempt runs; every attempt is still a result                                                              |
| `logErrorsBeforeRetry`                          | What Jest prints; every failed attempt's error is in its own result anyway                                           |
| `test.concurrent` on Jest 29                    | Never retried by Jest: one result                                                                                    |
| `test.concurrent` on Jest 30.0 to 30.4          | Each attempt is a result, but the `probara.*` calls of a retry go to the first attempt: Jest does not say which runs |
| `test.concurrent` on Jest 30.5 and later        | Each attempt is a result, with its own `probara.*` calls                                                             |

## Keeping retries out of your numbers

To send only the last attempt, do not retry in Jest: no option of the reporter drops attempts. To
keep failures of retried tests from counting, map them
([status mapping](statuses.md#status-mapping-and-filter)), knowing it applies to every failure.

## See also

- [Statuses](statuses.md).
- [Steps](steps.md) and [attachments](attachments.md): per attempt.
