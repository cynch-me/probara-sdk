# Retries and repeats

Every execution of a test is a result of its own: each attempt Vitest's `retry` gives it, and each
time `repeats` runs it again. A test retried once sends two results, in the order they ran, each
with its own status, duration, errors, steps and files.

<!-- project: retries -->

```ts
// tests/dashboard.test.ts
import { expect, test } from 'vitest';

let loads = 0;

test('loads the dashboard', { retry: 1 }, () => {
  loads += 1;
  // Fails the first time, passes on the retry.
  expect(loads).toBe(2);
});

test('opens the menu', { repeats: 2 }, () => {});
```

<!-- sent: retries -->

```json
[
  { "automationKey": "tests/dashboard.test.ts > loads the dashboard", "status": "failed" },
  {
    "automationKey": "tests/dashboard.test.ts > loads the dashboard",
    "status": "passed",
    "parameters": { "attempt": "2" }
  },
  { "automationKey": "tests/dashboard.test.ts > opens the menu", "status": "passed" },
  {
    "automationKey": "tests/dashboard.test.ts > opens the menu",
    "status": "passed",
    "parameters": { "repeat": "2" }
  },
  {
    "automationKey": "tests/dashboard.test.ts > opens the menu",
    "status": "passed",
    "parameters": { "repeat": "3" }
  }
]
```

<!-- output: retries -->

```text
$ npx vitest run
[probara] Sending 5 results of 2 tests (4 passed, 1 failed, 0 skipped, 0 blocked)
[probara] Recorded 5 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

- **What Probara shows.** The run case keeps the outcome of the last execution (`passed` here),
  and every execution stays in its history: a flaky test is a case whose history mixes failures
  and passes on the same run. The count of the log says it: more results than tests.
- **Parameters tell executions apart.** `attempt` is `2`, `3`... from the second attempt on, and
  `repeat` is `2`, `3`... from the second execution of `repeats` on. Each repeat retries on its
  own, so its attempts start again at 1: the second attempt of the second repeat has
  `{ "repeat": "2", "attempt": "2" }`. They win over `probara.parameters()` of the same name, and
  are never part of the key: every execution goes to the same case.
- **Each attempt starts empty.** `probara.*` calls, steps, files and console output belong to the
  attempt that made them, so a retry does not inherit what the first attempt recorded.
- **Errors per attempt.** A failed attempt's notes hold its own errors only, not those of the
  attempts before it.
- **No flaky flag.** The reporter does not mark attempts as flaky: the attempts themselves are the
  evidence. Vitest's JUnit output, and so `probara import junit`, has one result per test, however
  many attempts it took.

## Repeats

`repeats: 2` runs a test three times: once, then twice more. Vitest fails such a test when any of
its executions failed; Probara gets each execution with its own status, and no extra result for
Vitest's verdict, which would count a failure twice. So a repeated test whose last execution
passed shows `passed` in the run while Vitest failed it: its failed executions are in the case's
history.

## When retries run

Vitest retries a failed test right away, before the next test, with its `beforeEach` and
`afterEach` hooks around each attempt. Whatever sets the retries (the `retry` of the config, of a
`describe` or of a test, or `--retry`) and whatever its condition or delay, every attempt is a
result.

| Vitest                                        | What Probara gets                                             |
| --------------------------------------------- | ------------------------------------------------------------- |
| `retry`, `--retry`                            | One result per attempt                                        |
| `repeats`                                     | One result per execution, and per attempt of each execution   |
| `test.fails`                                  | One result: Vitest never retries a `test.fails` test          |
| `test.concurrent` with `retry`                | One result per attempt, each with its own errors              |
| A shard that ran with `--reporter=blob` alone | The final attempt only, with one warning at the merge (below) |

The attempts are recorded by the setup file the reporter adds to every Vitest project. Where it
does not run, Vitest still retries, but only the final attempt of each test can be sent, and one
warning says how many tests that was: `Vitest retried or repeated 1 test whose earlier attempts
were not recorded: only its final attempt is reported`. That happens when Vitest runs without the
reporter in its reporters, such as a shard run with `--reporter=blob` on the command line, which
replaces the reporters of the config: list the reporter beside `blob` in the config of the shards
instead.

## Keeping retries out of your numbers

To send only the last attempt, do not retry in Vitest: no option of the reporter drops attempts. To
keep failures of retried tests from counting, map them
([status mapping](statuses.md#status-mapping-and-filter)), knowing it applies to every failure.

## See also

- [Statuses](statuses.md): the status of each attempt.
- [Steps](steps.md): recorded per attempt.
- [Metadata](metadata.md#parameters): parameters of your own.
