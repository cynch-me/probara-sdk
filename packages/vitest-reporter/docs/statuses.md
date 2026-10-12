# Statuses

Each attempt is sent with Vitest's own verdict, as `passed`, `failed` or `skipped`.
`statusMapping` and `statusFilter` can change that afterwards.

## How an attempt becomes a status

| The attempt                                                                           | Status                                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Passed                                                                                | `passed`                                                         |
| Failed: an assertion, an error, a timeout, a `beforeEach` or `afterEach` that threw   | `failed`                                                         |
| `expect.soft` failures                                                                | `failed`, with every failure in the notes                        |
| `test.skip`, `skipIf`, `runIf`, a skipped `describe`, a test `.only` or `-t` left out | `skipped`                                                        |
| `test.todo`                                                                           | `skipped`, with the note `Todo`                                  |
| `context.skip()`; with a note, `context.skip('why')`                                  | `skipped`; with a note, the note `Skipped: why`                  |
| `test.fails`, and it threw as expected                                                | `passed`                                                         |
| `test.fails`, but it passed                                                           | `failed`, with Vitest's error `Expect test to fail`              |
| A test under a `beforeAll` that threw                                                 | `skipped`                                                        |
| A test Vitest never started, after `--bail` or Ctrl-C                                 | `skipped`, with the note `Not run: the test run was interrupted` |

The reporter never sends `blocked` on its own: map a status to it (below) when you need it.

<!-- project: statuses, exit: 1 -->

```ts
// tests/statuses.test.ts
import { expect, test } from 'vitest';

test('passes', () => {});

test('fails', () => {
  expect(1 + 1).toBe(3);
});

test.skip('is skipped', () => {});

test.todo('is not written yet');

test('skips itself', (context) => {
  context.skip('needs the payment sandbox');
});

test.fails('is a known bug', () => {
  expect(0.1 + 0.2).toBe(0.3);
});
```

<!-- sent: statuses -->

```json
[
  { "automationKey": "tests/statuses.test.ts > passes", "status": "passed" },
  { "automationKey": "tests/statuses.test.ts > fails", "status": "failed" },
  { "automationKey": "tests/statuses.test.ts > is skipped", "status": "skipped" },
  {
    "automationKey": "tests/statuses.test.ts > is not written yet",
    "status": "skipped",
    "notes": "Todo"
  },
  {
    "automationKey": "tests/statuses.test.ts > skips itself",
    "status": "skipped",
    "notes": "Skipped: needs the payment sandbox"
  },
  { "automationKey": "tests/statuses.test.ts > is a known bug", "status": "passed" }
]
```

- **Order.** Results are sent file by file once the run ends, each file's tests in the order they
  are written, and every attempt of a test in the order it ran.
- **Errors** go in the notes of the result: every error of the attempt, `expect.soft` failures
  included, in order, each with its message and stack, without the terminal's colors, after a
  [comment](metadata.md#comment) if the test wrote one. A passed attempt sends no error.
- **Skips are not told apart.** Vitest reports `test.skip`, `skipIf`, `runIf`, `.only` and `-t`
  the same way, and so does its JUnit output: they are skipped results with no note, as
  `probara import junit` records them.
- **Todo tests** are never lost: they are skipped results with the note `Todo`, so the case shows
  what is still to be written.
- **Expected failures** are Vitest's: a `test.fails` test that throws does what it should, so it
  passes. When the bug is fixed, the test passes, Vitest fails it, and so does Probara, reminding
  you to remove `.fails`.
- **An interrupted run** (`--bail`, Ctrl-C) still reports what it ran. A test Vitest never started
  is skipped with the note `Not run: the test run was interrupted`; a test Vitest skipped itself
  because the run was cancelled keeps Vitest's note, `The test run was aborted by the user.` A test
  file Vitest never started has no test to report: one warning counts such files.

## Errors outside a test

An error in a suite's hook or in the file itself fails the file in Vitest, even when its tests
pass. The reporter sends the failed results Vitest's JUnit output writes for it, with the error in
their notes, so Probara does not show the file as green either:

| Where the error happens                                                       | What Probara gets                                                                       |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The `beforeAll` or `afterAll` of a `describe`                                 | One failed result named after the `describe`: `tests/session.test.ts > session`         |
| A `beforeAll` or `afterAll` outside every `describe`                          | One failed result named after the file: `tests/cleanup.test.ts > tests/cleanup.test.ts` |
| The test file fails to load (a syntax error, an import that throws)           | One failed result named after the file: `tests/broken.test.ts > tests/broken.test.ts`   |
| An unhandled error: a rejection no test awaited, an error thrown from a timer | No result: Vitest lists it under its unhandled errors, and one warning counts them      |

<!-- project: hooks, exit: 1 -->

```ts
// tests/session.test.ts
import { beforeAll, describe, test } from 'vitest';

describe('session', () => {
  beforeAll(() => {
    throw new Error('Could not seed the users');
  });

  test('renews the token', () => {});
});

test('logs out', () => {});
```

<!-- sent: hooks -->

```json
[
  { "automationKey": "tests/session.test.ts > session", "status": "failed" },
  { "automationKey": "tests/session.test.ts > session > renews the token", "status": "skipped" },
  { "automationKey": "tests/session.test.ts > logs out", "status": "passed" }
]
```

The failed results come first in their file. Their keys are the ones `probara import junit` gives
the same failures in Vitest's JUnit output, so both tools record them into the same case, odd names
included: Vitest's JUnit writer names a hook's failure after its own `describe`, not after the
`describe` blocks above it, and a file's failure after the file, which its key then holds twice.

A file that fails to load is one failed result, whatever tests it holds:

<!-- project: broken, exit: 1 -->

```ts
// tests/broken.test.ts
import { expect, test } from 'vitest';
import { total } from './missing-module';

test('adds the items', () => {
  expect(total([1, 2])).toBe(3);
});
```

<!-- sent: broken -->

```json
[
  {
    "automationKey": "tests/broken.test.ts > tests/broken.test.ts",
    "status": "failed"
  }
]
```

Fix the file: Vitest's own output shows the error in full.

## Status mapping and filter

`statusMapping` sends a status as another; `statusFilter` sends no result with the given statuses,
after the mapping. Both take `passed`, `failed`, `skipped` and `blocked`:

<!-- project: mapping, exit: 1 -->

```ts
reporters: [
  'default',
  [
    '@probara/vitest-reporter',
    { statusMapping: { failed: 'blocked' }, statusFilter: ['skipped'] },
  ],
],
```

<!-- project: mapping -->

```ts
// tests/filters.test.ts
import { expect, test } from 'vitest';

test('passes', () => {});

test('fails', () => {
  expect(true).toBe(false);
});

test.todo('is not written yet');
```

<!-- output: mapping -->

```text
$ npx vitest run
[probara] Sending 2 results of 2 tests (1 passed, 0 failed, 0 skipped, 1 blocked); 1 left out by statusFilter
[probara] Recorded 2 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Filtered out 1 result by their status (statusFilter): not sent
```

As variables: `PROBARA_STATUS_MAPPING=failed=blocked,skipped=passed` and
`PROBARA_STATUS_FILTER=skipped,blocked`. A value that is not a status, or a status mapped twice, is
a configuration problem that turns reporting off. `statusFilter: ['skipped']` leaves out todo tests
too: they are skipped results. The mapping changes what Probara records only: Vitest's exit code
stays the tests' own.

## See also

- [Retries and repeats](retries.md): the status of each attempt.
- [Metadata](metadata.md#comment): a comment before the error.
- [Configuration](configuration.md): `statusMapping` and `statusFilter` with the other options.
