# Captured output

`captureOutput: true` (`PROBARA_CAPTURE_OUTPUT=true`) attaches what each attempt writes to the
console: `console.log`, `console.info` and `console.debug` as `stdout.log`, and `console.warn` and
`console.error` as `stderr.log`, `text/plain`, each only when it has text. It is off by default,
and needs nothing else: no setup file, no change to the tests. Vitest still prints the output as
usual.

<!-- project: output -->

```ts
reporters: ['default', ['@probara/vitest-reporter', { captureOutput: true }]],
```

<!-- project: output -->

```ts
// tests/logs.test.ts
import { beforeEach, test } from 'vitest';

beforeEach(() => {
  console.info('Seeding the cart');
});

test('prints what it does', () => {
  console.log('Opening the cart');
  console.error('Slow response: 2.1 s');
});
```

<!-- files: output -->

```text
stdout.log text/plain
stderr.log text/plain
```

Here `stdout.log` holds `Seeding the cart` and `Opening the cart`, and `stderr.log` holds
`Slow response: 2.1 s`: a test's `beforeEach` and `afterEach` hooks write into its attempt.

## What each attempt gets

| Output                                                         | Where it goes                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The test body, its `beforeEach` and `afterEach` hooks          | The attempt that wrote it                                               |
| Each attempt of a retried or repeated test                     | Its own `stdout.log` and `stderr.log`                                   |
| A `test.concurrent` test, or a test in a `describe.concurrent` | Left out, with one warning                                              |
| A retried test whose attempts were not recorded                | Left out, with one warning (see [retries](retries.md#when-retries-run)) |
| The module scope, a `describe` body, `beforeAll`, `afterAll`   | Not attached: Vitest gives it to no test                                |

- **Concurrent tests are left out.** Vitest gives each write to the test current in its worker,
  which is not always the test that wrote it when tests run at once: rather than attach a write to
  the wrong test, the reporter leaves the output of concurrent tests out, and says how many.
- **Retries are split by time.** An attempt's files hold what Vitest received from its start to the
  start of the next attempt. Vitest hands the reporter a test's writes in batches, so a write made
  right as a retry starts can land in the file of the attempt before it.

<!-- project: concurrent-output -->

```ts
reporters: ['default', ['@probara/vitest-reporter', { captureOutput: true }]],
```

<!-- project: concurrent-output -->

```ts
// tests/search.test.ts
import { test } from 'vitest';

test.concurrent('finds boots', async () => {
  console.log('searching for boots');
});

test('finds hats', () => {
  console.log('searching for hats');
});
```

Only the test that runs alone gets its output:

<!-- files: concurrent-output -->

```text
stdout.log text/plain
```

<!-- output: concurrent-output -->

```text
$ npx vitest run
[probara] The console output of 1 test is left out: Vitest attributes the writes of concurrent tests to the wrong test, and the attempts of a retried or repeated test without recorded attempts cannot be told apart (first seen in the run; repeats are logged at debug)
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Attached 1 file to results (0 skipped, 0 failed)
```

## `silent` and `onConsoleLog`

Vitest's `silent` and `onConsoleLog` decide what the terminal shows, not what reporters get: the
output they hide is still attached. To keep a test's output out of Probara, leave `captureOutput`
off.

<!-- project: silent -->

```ts
silent: true,
reporters: ['default', ['@probara/vitest-reporter', { captureOutput: true }]],
```

<!-- project: silent -->

```ts
// tests/quiet.test.ts
import { test } from 'vitest';

test('works quietly', () => {
  console.log('nothing shows in the terminal');
});
```

<!-- files: silent -->

```text
stdout.log text/plain
```

## Limits

- **32 MiB per test and stream.** Past it, the stream keeps what fits and ends with the line
  `[probara] The output of this test was cut here: an attachment holds at most 32 MiB`. The
  output of a whole run is not capped.
- **Kept in memory.** The reporter holds the output of the run's tests until the run ends, when it
  sends the results: a run whose tests write a lot needs the memory for it.
- **Sharded runs keep it.** A shard's blob holds its tests' output, and `vitest --merge-reports`
  attaches the same files as a run that was not sharded ([sharding](ci/sharding.md)).

## See also

- [Attachments](attachments.md): the other files of a result, and their limits.
- [Retries and repeats](retries.md): the attempts that get their own files.
- [Configuration](configuration.md): `captureOutput` with the other options.
