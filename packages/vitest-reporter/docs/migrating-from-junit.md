# Migrating from the JUnit import

If your pipeline writes Vitest's JUnit output and sends it with `probara import junit`, the
reporter can replace both steps **without unlinking a single case**: it gives each test the
automation key and the case the import gives it, on Vitest 3, 4 and 5. Then each test sends what
the XML cannot hold: every attempt, steps, files, parameters and the `probara.*` calls. The
reporter is the recommended path; keep the import for a job that only has the XML.

## Quick path

1. Add the reporter to the Vitest config ([quick start](../README.md#quick-start)). There is
   nothing else to set: Vitest's JUnit output always names the test file, as the reporter's
   default keys do (`keyIncludesFile: true`).
2. [Check the keys](#check-the-keys-before-you-switch) of both on the same tests: they must be
   equal.
3. In CI, drop `--reporter=junit` and the import step, and give the test step
   `PROBARA_API_TOKEN` ([in CI](#in-ci)).

| Vitest's JUnit output                                        | Reporter setting                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `--reporter=junit`, with or without `addFileAttribute: true` | Nothing: `keyIncludesFile: true` is the default                    |
| Written with another `ancestorSeparator` (Vitest 5)          | Different keys: link the tests by case ids ([linking](linking.md)) |

Run `vitest` from the same root as before: the file of each key is relative to it, on both paths.
`keyIncludesFile: false` has no JUnit counterpart: it gives the keys of cases made by hand or by
another tool, without the file ([without the file](linking.md#without-the-file)).

## Check the keys before you switch

Run the suite once with Vitest's JUnit output and once with the reporter's
[results file](results-file.md), reporting off, and compare the dry runs of both: each prints one
line per result, with its status, its case and its key. No token is needed. For this test file:

<!-- project: junit-keys -->

```ts
// tests/refund.test.ts
import { describe, expect, test } from 'vitest';

describe('refund', () => {
  test('SHOP-12 refunds an order', () => {
    expect(25 - 25).toBe(0);
  });

  test('keeps the receipt', () => {
    expect('receipt').toHaveLength(7);
  });

  test.todo('refunds a gift card');
});
```

<!-- output: junit-keys, scenario: not-configured, stream: stdout -->

```text
$ npx vitest run --reporter=junit --outputFile=reports/vitest.xml
$ PROBARA_PROJECT=SHOP npx @probara/cli import junit reports/vitest.xml --dry-run
passed	SHOP-12	tests/refund.test.ts > refund > refunds an order
passed	-	tests/refund.test.ts > refund > keeps the receipt
skipped	-	tests/refund.test.ts > refund > refunds a gift card
Total: 3 results from 1 file (2 passed, 0 failed, 1 skipped, 0 blocked)
$ PROBARA_ENABLED=false PROBARA_PROJECT=SHOP PROBARA_RESULTS_FILE=probara-results.json npx vitest run
[probara] Wrote 3 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ npx @probara/cli import results probara-results.json --dry-run
passed	SHOP-12	tests/refund.test.ts > refund > refunds an order
passed	-	tests/refund.test.ts > refund > keeps the receipt
skipped	-	tests/refund.test.ts > refund > refunds a gift card
Total: 3 results from 1 file (2 passed, 0 failed, 1 skipped, 0 blocked)
```

The lines are the same: the same keys, cases and statuses. `--reporter=junit` replaces the config's
reporters for that run, so the reporter sends nothing then. On a real suite, write each dry run to
a file and `diff` them: a line whose key changed is a test that would get a new case
([check what would be sent](debugging.md#check-what-would-be-sent)). Delete `reports/` and the
results file afterwards.

## In CI

Before, two steps: Vitest writes the report, and the CLI sends it.

```yaml
- name: Run the tests
  run: npx vitest run --reporter=junit --outputFile=reports/vitest.xml
- name: Send the results
  if: ${{ !cancelled() }}
  run: npx @probara/cli import junit reports/vitest.xml
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
    PROBARA_PROJECT: SHOP
```

After, one step: the reporter, registered in the Vitest config, sends every result when the run
ends.

```yaml
- name: Run the tests
  run: npx vitest run
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
    PROBARA_PROJECT: SHOP
```

Remove `--reporter=junit` from the command: it replaces the reporters of the config, the
reporter's included. When another tool still reads the XML (a test summary of the CI), list
`junit` beside the reporter instead:

```ts
reporters: ['default', 'junit', '@probara/vitest-reporter'],
outputFile: { junit: 'reports/vitest.xml' },
```

The run is named, sourced and closed as the import did it ([run options](runs.md)).

## What changes

The keys stay; what each test sends grows, and a few results become more exact:

| Topic                       | `probara import junit` on Vitest's JUnit output                                                                 | The reporter                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Retries (`retry`)           | One result per test: a pass on a retry is a plain pass; a test that fails every attempt keeps its first failure | Every attempt, in order, each with its own errors; the run case keeps the last outcome ([retries](retries.md))           |
| Repeats (`repeats`)         | One result per test                                                                                             | Every execution ([repeats](retries.md#repeats))                                                                          |
| `test.todo`                 | `skipped`                                                                                                       | `skipped`, with the note `Todo` ([statuses](statuses.md))                                                                |
| `context.skip('why')`       | `skipped`: Vitest writes no reason                                                                              | `skipped`, with the note `Skipped: why`                                                                                  |
| `expect.soft` failures      | The first failure's message                                                                                     | Every failure of the attempt, in the notes                                                                               |
| Console output              | `--attach-output`: the test's `<system-out>` and `<system-err>`                                                 | `captureOutput`: `stdout.log` and `stderr.log` for each attempt ([captured output](output.md))                           |
| Vitest projects             | No project: Vitest's JUnit output does not name it                                                              | A `project` parameter on each result, when the config has more than one ([Vitest projects](projects.md#vitest-projects)) |
| Unhandled errors (Vitest 5) | Left out, with one warning per file; `--fail-on-failed-tests` exits 3 for them                                  | Left out, with one warning; the exit code stays Vitest's ([errors outside a test](statuses.md#errors-outside-a-test))    |
| When the results go         | After the whole run, in a later step                                                                            | At the end of the run, from the test step; a [results file](results-file.md) keeps what could not be sent                |

The same on both paths, so no case moves:

- The statuses of passed, failed and skipped tests, `test.fails` included, and the tests `.only`
  or `-t` leave out, which are skipped on both.
- The failed results of a `beforeAll` or `afterAll` that throws, and of a file that fails to load,
  named as Vitest's JUnit writer names them
  ([errors outside a test](statuses.md#errors-outside-a-test)).
- Case ids in test and `describe` titles, the names of `test.each` and `test.for` rows, and a `>`
  with a space on each side inside a title
  ([names as Vitest writes them](linking.md#names-as-vitest-writes-them)).

## What the import cannot know

The XML holds each test's name, outcome, time and output. What the tests tell the reporter, and
what Vitest gives it beyond its JUnit output, never reaches the import:

- **Every attempt** of a retried or repeated test, each with its status, duration and errors.
- **Case ids from `probara.id()`**, which live in the test's own metadata, not in its title
  ([linking](linking.md)).
- **Steps**, nested, with their status and duration, and the steps of a new case
  ([steps](steps.md)).
- **Files**: `probara.attach()`, the files of Vitest's own `context.annotate()`, failure
  screenshots in browser mode ([attachments](attachments.md)).
- **Parameters, comments, links and the fields of a new case**: the `probara.*` helpers
  ([metadata](metadata.md), [links](links.md)).
- **Run selection**: run only the tests of a Probara run ([run selection](run-selection.md)).

Keep the import where the reporter cannot run: a job that only receives the XML of another job, or
a Vitest older than 3.2, which the reporter does not support (the import is tested with Vitest
3.2, 4.1 and 5.0).

## Cases made by an earlier import

`probara import junit` reads Vitest's output with its `vitest` dialect, detected from the report's
root (`vitest tests`), with no option
([Vitest JUnit](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/junit.md#vitest)).
Versions of the CLI before that dialect (0.3.0 and earlier) read the same XML as generic JUnit,
which gives every test the same key, with two differences:

| Result                                                            | Generic JUnit (the CLI 0.3.0 and earlier)       | The reporter, and the `vitest` dialect                        |
| ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| A failure named after its file, such as a file that fails to load | Keyed by the file alone: `tests/broken.test.ts` | The file twice: `tests/broken.test.ts > tests/broken.test.ts` |
| An unhandled error (Vitest 5)                                     | A failed result of its own                      | Left out, with a warning                                      |

Only those results move: the next failure of such a file creates a case under its new key, and the
old case gets no more results. Every other test keeps its case.

## See also

- [The same keys as `probara import junit`](linking.md#the-same-keys-as-probara-import-junit).
- [`keyIncludesFile`](linking.md#without-the-file).
- [Debugging](debugging.md#check-what-would-be-sent): compare the keys of two runs.
- [Coming from other tools](coming-from-other-tools.md): Qase, Allure, ReportPortal and TestRail.
