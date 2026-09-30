# Migrating from the JUnit import

If your pipeline writes a report with [jest-junit](https://github.com/jest-community/jest-junit)
and sends it with `probara import junit`, the reporter can replace both steps **without unlinking a
single case**: it gives each test the automation key the import gives it. One setting decides
which keys: whether jest-junit wrote the test file into the report.

## Quick path

1. Find how jest-junit ran in your pipeline: with `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true` (or
   `addFileAttribute: 'true'` in its options), or without it (its default).
2. Add the reporter to the Jest config ([quick start](../README.md#quick-start)). Without the file
   attribute, also set `keyIncludesFile: false`.
3. [Check the keys](#check-the-keys-before-you-switch) of both on the same tests: they must be
   equal.
4. In CI, drop jest-junit and the import step, and give the test step `PROBARA_API_TOKEN`
   ([in CI](#in-ci)).

| jest-junit wrote                                          | Reporter setting                                       |
| --------------------------------------------------------- | ------------------------------------------------------ |
| The file attribute (`JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`) | Nothing: `keyIncludesFile: true` is the default        |
| No file attribute (jest-junit's default)                  | `keyIncludesFile: false` (`PROBARA_KEY_INCLUDES_FILE`) |

Without the file attribute:

<!-- project: junit-without-file -->

```js
reporters: ['default', ['@probara/jest-reporter', { keyIncludesFile: false }]],
```

<!-- sent: junit-without-file -->

```json
[
  { "automationKey": "cart adds an item", "caseDisplayId": "SHOP-12" },
  { "automationKey": "cart removes an item" },
  { "automationKey": "login logs in with a valid password" }
]
```

The keys are the ones the import gives on jest-junit's **default templates**: the describe blocks
and the title joined with spaces (`{classname} {title}`). A report written with other templates
(`classNameTemplate`, `titleTemplate`, `ancestorSeparator`, `suiteNameTemplate`) has other keys:
the check below shows the difference, and ids in the titles keep those tests linked whatever their
keys ([linking](linking.md)).

## Check the keys before you switch

Run the suite once with jest-junit and once with the reporter's [results file](results-file.md),
reporting off, and compare the dry runs of both: each prints one line per result, with its status,
its case and its key. For this test file:

<!-- project: junit-keys -->

```js
// tests/refund.test.js
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

<!-- output: junit-keys, stream: stdout -->

```text
$ JEST_JUNIT_ADD_FILE_ATTRIBUTE=true npx jest --reporters=default --reporters=jest-junit
$ npx @probara/cli import junit junit.xml --dry-run
passed	SHOP-12	tests/refund.test.js > refund refunds an order
passed	-	tests/refund.test.js > refund keeps the receipt
passed	-	tests/refund.test.js > refund refunds a gift card
Total: 3 results from 1 file (3 passed, 0 failed, 0 skipped, 0 blocked)
$ PROBARA_ENABLED=false PROBARA_RESULTS_FILE=probara-results.json npx jest
[probara] Wrote 3 results to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
$ npx @probara/cli import results probara-results.json --dry-run
passed	SHOP-12	tests/refund.test.js > refund refunds an order
passed	-	tests/refund.test.js > refund keeps the receipt
skipped	-	tests/refund.test.js > refund refunds a gift card
Total: 3 results from 1 file (2 passed, 0 failed, 1 skipped, 0 blocked)
```

The keys and cases are the same; only the status of the `test.todo` differs (see
[what changes](#what-changes)). On a real suite, write each dry run to a file and `diff` them: a
line whose key changed is a test that would get a new case. Delete `junit.xml` and the results file
afterwards ([check what would be sent](debugging.md#check-what-would-be-sent)).

## In CI

Before, two steps: jest-junit writes the report, and the CLI sends it.

```yaml
- name: Run Jest tests
  run: npx jest --ci --reporters=default --reporters=jest-junit
  env:
    JEST_JUNIT_ADD_FILE_ATTRIBUTE: 'true'
- name: Send the results
  if: ${{ !cancelled() }}
  run: npx @probara/cli import junit junit.xml
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
    PROBARA_PROJECT: SHOP
```

After, one step: the reporter, registered in the Jest config, sends every result as the tests run.

```yaml
- name: Run Jest tests
  run: npx jest --ci
  env:
    PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
    PROBARA_PROJECT: SHOP
```

Remove `--reporters=jest-junit` (it would replace the config's reporters, the reporter included),
and jest-junit itself unless something else reads its report. The run is named, sourced and closed
as the import did it ([run options](runs.md)).

## What changes

The keys stay; what each test sends grows, and a few statuses become more exact:

| Topic                                     | `probara import junit` on jest-junit                                    | The reporter                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `test.todo`                               | `passed`: jest-junit writes a todo as a passed testcase                 | `skipped`, with the note `Todo`: a test not written yet never counts as passing ([statuses](statuses.md))      |
| Retries (`jest.retryTimes`)               | The last attempt only                                                   | Every attempt, in order; the run case keeps the last outcome ([retries](retries.md))                           |
| Tests left out by `-t` or `.only`         | `skipped`                                                               | `skipped` too                                                                                                  |
| A failing `afterAll` hook                 | One more failed testcase for the file                                   | The same failed result, with the same key                                                                      |
| A file that fails to load                 | Nothing (jest-junit writes nothing for it by default)                   | Nothing to report, and one warning names the file                                                              |
| When the results go                       | After the whole run, in a later step                                    | Sent at the end of the run, from the test step; a [results file](results-file.md) keeps what could not be sent |
| Suite of a created case, without the file | The first describe of the file's first test, for every test of the file | Each test's own first describe (none for a test outside any describe)                                          |

The last row only changes where a case the report **creates** goes, with `keyIncludesFile: false`:
a new test in a file whose tests sit in different top-level describes. Its key, and so the case an
existing test matches, is the same. With the file attribute, both put a created case in a suite
named after the file.

The reporter follows jest-junit's naming to the letter, quirks included, so the keys stay equal:

- A `{displayName}` in a describe or a title becomes the Jest project's name, as jest-junit fills it
  in ([Jest projects](projects.md#jest-projects)).
- `$&`, `$$` and the other `$` patterns of `String.replace` in a title expand as they do in
  jest-junit's templates.
- A test of a file whose `afterAll` throws gets the extra failed result jest-junit writes, keyed
  `<file> > Test execution failure: could be caused by test hooks like 'afterAll'.`

## What you gain

- **Every attempt** of a retried test, each with its status, duration and start time.
- **Steps**, nested, with their status, duration and error: `probara.step()` ([steps](steps.md)).
- **Files**: `probara.attach()` and each test's console output with `captureOutput`
  ([attachments](attachments.md)).
- **Links and issues** of a result: `probara.link()`, `probara.issue()` ([links](links.md)).
- **Parameters**, and the title, suite, tags, fields and steps of a new case ([metadata](metadata.md)).
- **Run selection**: run only the tests of a Probara run ([run selection](run-selection.md)).
- **Failed results assigned** to the people you name ([assign failed results](assign-failed.md)),
  as `--assign-failed-to` did for the import.

## See also

- [Same cases as the JUnit import](../README.md#same-cases-as-the-junit-import).
- [`keyIncludesFile`](configuration.md#keyincludesfile).
- [Linking tests to cases](linking.md#automation-keys).
