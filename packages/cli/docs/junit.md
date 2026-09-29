# JUnit mapping and dialects

Every `<testcase>` of every file becomes one Probara result (or one per linked case). This page
shows how each part of a report is read, then how each framework should write its report.

## Quick path

1. Make the framework write JUnit XML: pick your tool below ([Jest](#jest), [pytest](#pytest),
   [Playwright](#playwright), [Maven Surefire](#maven-surefire), [Go with gotestsum](#go-with-gotestsum),
   [any other tool](#generic-junit)).
2. Run `probara import junit <files> --dry-run` and read the keys it prints: they are what cases
   are matched on.
3. Import the files. The dialect is detected per file; `--dialect` overrides it for every file.

## From JUnit elements to results

| JUnit                                          | Probara                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `<testsuites>` or a single root `<testsuite>`  | One import. Every file of the command goes into the same run.          |
| `<testsuite>`, nested ones included            | A group of testcases. Its `timestamp` is when they ran.                |
| `<testcase>`                                   | One result, or one per case it links to ([linking](linking.md)).       |
| `classname`, `name` (and `file`)               | The title path, file and automation key, per [dialect](#dialects)      |
| `time` (seconds)                               | The duration, in milliseconds (rounded)                                |
| `<failure>`, `<error>`, `<skipped>`, none      | The status (see below)                                                 |
| `message` and text of the outcome element      | The notes: the message, then the stack or output                       |
| `<system-out>`, `<system-err>` of the testcase | Scanned for attachments; attached as text files with `--attach-output` |
| `<property name="probara_case">`               | Case ids ([linking](linking.md#the-probara_case-property))             |
| `<property name="probara_attachment">`         | A file to attach ([attachments](attachments.md))                       |

Other properties, suite-level output and the counts on `<testsuite>` are not read. A testcase
without a `name` is skipped with a warning.

### Statuses

| The testcase has   | Status                                               | Notes                                 |
| ------------------ | ---------------------------------------------------- | ------------------------------------- |
| no outcome element | `passed`                                             | —                                     |
| `<failure>`        | `failed`                                             | message and body                      |
| `<error>`          | `failed`, or `blocked` with `--error-status blocked` | message and body                      |
| `<skipped>`        | `skipped`                                            | `Skipped: <reason>` when there is one |

A `<failure>` wins over an `<error>` on the same testcase (such as a teardown error after a failed
assertion). A failure or error wins over `<skipped>`. Frameworks use `<error>` for an unexpected
exception or a broken setup; `--error-status blocked` records those as blocked, so they stand out
from assertion failures. `--fail-on-failed-tests` counts failed and blocked results.

The notes hold at most 4000 characters: core strips ANSI colors and cuts the rest with
`…[truncated]`.

### Flaky tests and reruns

A report that keeps every attempt of a rerun test (Surefire with `rerunFailingTestsCount`,
Playwright with `includeRetries`) gives one result per test, with the final outcome:

| The testcase has                                    | Status   | Notes                                                  |
| --------------------------------------------------- | -------- | ------------------------------------------------------ |
| `<flakyFailure>` or `<flakyError>` only (it passed) | `passed` | `Passed after 1 failed attempt.` and the first failure |
| `<failure>` or `<error>` plus `<rerunFailure>`...   | `failed` | the error, then `Failed in all 3 attempts.`            |

Without those options, most tools write only the final attempt: a flaky test is a plain pass.

### Durations and timestamps

- **Duration**: the testcase `time`, in seconds, times 1000 and rounded. A testcase without a
  numeric `time` (Playwright's skipped tests) has no duration.
- **When it ran**: the `timestamp` of its `<testsuite>`, sent as the execution time of every result
  of that suite. A suite without a timestamp (Surefire) sends none.
- **Time zones**: a timestamp with `Z` or an offset (`2026-09-29T14:05:00-05:00`) is exact. One
  without an offset is read as the local time of the machine that runs the import, except for
  Jest: jest-junit writes UTC without an offset, so the CLI adds the `Z`. If the tests ran in
  another time zone than the import, set `TZ` for the import (`TZ=UTC probara import junit ...`).

### Output

`<system-out>` and `<system-err>` are not copied into the notes. The CLI reads them for
`[[ATTACHMENT|path]]` lines, and `--attach-output` attaches them as `system-out.txt` and
`system-err.txt` ([attachments](attachments.md#test-output)).

### Suites of created cases

A created case goes into a suite path built from the report: the classname for pytest (split on
`.`), Surefire (split on `$`) and generic reports; the file, then the describe blocks, for Jest and
Playwright; the package, then the parent tests, for Go.

### Order and several files

- Files follow the order of the paths on the command line; the files of one glob or directory are
  sorted by path. Results keep the order of the testcases in each file.
- Every file goes into one run. When the same test appears twice (two files, or a rerun written as
  two testcases), both results are recorded, and the run case keeps the **last** one.
- A file matched by two patterns is read once.

## Dialects

### Dialect detection

The dialect is detected per file, in this order. The first match wins:

| Dialect      | Detected by                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| `gotestsum`  | a suite property `go.version`                                                       |
| `pytest`     | the root named `pytest tests`, or a suite named `pytest`                            |
| `jest`       | the root named `jest tests`                                                         |
| `surefire`   | a root `<testsuite>` with a Surefire schema attribute or `surefire.*` properties    |
| `playwright` | every classname equals its suite name, and the root has an `id` or a name holds `›` |
| `generic`    | anything else                                                                       |

The pre-flight log names the dialect of each file (`reports/go.xml: gotestsum, 13 results`). Pass
`--dialect <name>` when a tool mimics another one, or a custom `JEST_JUNIT_SUITE_NAME` or root name
hides the marks. `--dialect` applies to every file of the command, so import files of different
tools with one command each when you need it. Changing the dialect of a report changes its keys.

### Jest

Use [jest-junit](https://github.com/jest-community/jest-junit) with the file attribute on:

```bash
JEST_JUNIT_OUTPUT_DIR=reports JEST_JUNIT_ADD_FILE_ATTRIBUTE=true npx jest --ci --reporters=default --reporters=jest-junit
npx @probara/cli import junit reports/junit.xml
```

`JEST_JUNIT_ADD_FILE_ATTRIBUTE=true` adds the test file to each testcase, and so to its key: two
files with the same describe and test names then stay two cases. Without it, the key is the name
alone. Decide once: turning it on later changes every key.

- **Identity**: the `file` attribute when present; the title path is the test name, which
  jest-junit writes as the describe blocks and the title joined with spaces (the classname repeats
  it and is ignored). A test outside any describe has no suite name.
- **Timestamps**: UTC without an offset; the CLI adds `Z`.
- **Quirks**: jest-junit writes every failure as `<failure>` (never `<error>`), `<skipped/>` has no
  reason, and testcases get no output: `JEST_JUNIT_INCLUDE_CONSOLE_OUTPUT` writes a suite-level
  output, which the CLI does not read.

Real keys, from jest 30 and jest-junit 17 with the file attribute:

<!-- output: dry-run-stdout -->

```text
$ PROBARA_PROJECT=PRB probara import junit reports/junit.xml --dry-run
passed	PRB-12	src/__tests__/login.test.js > login logs in with a valid password
failed	-	src/__tests__/login.test.js > login rejects a wrong password
failed	-	src/__tests__/login.test.js > login crashes on an unexpected exception
skipped	-	src/__tests__/login.test.js > login supports SSO (skipped: SSO provider not configured)
passed	-	src/__tests__/login.test.js > login session refresh renews the token before expiry
passed	-	src/__tests__/login.test.js > login username alice has length 5
passed	-	src/__tests__/login.test.js > login username bob has length 3
passed	-	src/__tests__/login.test.js > login prints to stdout and stderr
passed	-	src/__tests__/login.test.js > login accepts café and ñandú
passed	PRB-13	src/__tests__/top-level.test.js > top-level test outside any describe
Total: 10 results from 1 file (7 passed, 2 failed, 1 skipped, 0 blocked)
```

### pytest

```bash
pytest --junitxml=reports/pytest.xml
npx @probara/cli import junit reports/pytest.xml
```

The default `junit_family=xunit2` is fine; `xunit1` gives the same keys (its `file` attribute is
ignored). Add `-o junit_logging=all` if you want the captured output as attachments
(`--attach-output`).

- **Identity**: the classname (the module path, then the classes: `tests.test_login.TestSession`)
  and the test name, parameters included (`test_username_length[alice-5]`).
- **Linking**: `record_property("probara_case", "SHOP-12")`, or an id in the function name, in
  upper case: `test_SHOP_12_...`. `test_shop_12_...` is not an id: codes are case-sensitive.
- **Statuses**: an assertion or exception in the test is `<failure>`; an exception in a fixture
  (setup or teardown) is `<error>`, which `--error-status blocked` records as blocked.
- **Timestamps**: local time with an offset: exact.
- **Quirks**: pytest escapes non-ASCII parameter ids in names (`caf\xe9`), so the key holds the
  escape. Suites are the dotted module path.

Real keys, from pytest 8.4:

<!-- output: dry-run-stdout -->

```text
$ PROBARA_PROJECT=PRB probara import junit reports/pytest.xml --dry-run
passed	-	tests.test_login > test_prb_12_logs_in_with_a_valid_password
failed	-	tests.test_login > test_rejects_a_wrong_password
failed	-	tests.test_login > test_crashes_on_an_unexpected_exception
failed	-	tests.test_login > test_errors_in_fixture_setup
skipped	-	tests.test_login > test_supports_sso
passed	-	tests.test_login.TestSession.TestRefresh > test_renews_the_token_before_expiry
passed	-	tests.test_login > test_username_length[alice-5]
passed	-	tests.test_login > test_username_length[bob-3]
passed	PRB-13	tests.test_login > test_records_a_probara_case_property
passed	-	tests.test_login > test_prints_to_stdout_and_stderr
passed	-	tests.test_login > test_accepts_café_and_ñandú
passed	PRB-14	tests.test_login > test_unicode_parameter_ids[accepts caf\xe9]
passed	-	tests.test_login > test_unicode_parameter_ids[rejects \xf1and\xfa]
Total: 13 results from 1 file (9 passed, 3 failed, 1 skipped, 0 blocked)
```

The first test is not linked: `prb_12` is lower case.

### Playwright

Add the `junit` reporter next to the one you use:

```js
// playwright.config.js
module.exports = defineConfig({
  reporter: [['list'], ['junit', { outputFile: 'reports/playwright.xml' }]],
});
```

```bash
npx playwright test
npx @probara/cli import junit reports/playwright.xml
```

- **Identity**: the file is the spec path (relative to `testDir`), the title path is the describe
  blocks and the title (Playwright joins them with `›`), and the Playwright project is a
  parameter: `login.spec.js > login > logs in [project=chromium]`. Two projects running the same
  test give two keys, so two cases. The `[project] ` prefix of `includeProjectInTestName` is removed.
- **Linking**: an annotation `{ type: 'probara_case', description: 'SHOP-12' }` becomes a testcase
  property; ids in titles work too. Tags (`@smoke`) are not written by Playwright.
- **Statuses**: an `expect` failure is `<failure>`, a thrown error is `<error>`. The skip reason
  comes from the `skip` property Playwright writes.
- **Retries**: by default a flaky test is a plain pass, and its time is the sum of every attempt.
  `includeRetries` (the `PLAYWRIGHT_JUNIT_INCLUDE_RETRIES=1` variable) keeps each attempt, and the
  notes say `Passed after 1 failed attempt.`
- **Attachments**: Playwright writes `[[ATTACHMENT|...]]` lines for attachments with a `path`
  only. Attachments with a `body` (`testInfo.attach('note', { body })`) never reach the XML, so
  the CLI cannot upload them: write them to a file and attach the path instead.
- **Timestamps**: UTC with `Z`.

Real keys, from Playwright 1.63 with one project named `node`:

<!-- output: dry-run-stdout -->

```text
$ PROBARA_PROJECT=PRB probara import junit reports/playwright.xml --dry-run
passed	PRB-12	login.spec.js > login > logs in with a valid password [project=node]
failed	-	login.spec.js > login > rejects a wrong password [project=node]
failed	-	login.spec.js > login > crashes on an unexpected exception [project=node]
skipped	-	login.spec.js > login > supports SSO [project=node]
passed	-	login.spec.js > login > session > refresh > renews the token before expiry [project=node]
passed	-	login.spec.js > login > username alice has length 5 [project=node]
passed	-	login.spec.js > login > username bob has length 3 [project=node]
passed	PRB-13	login.spec.js > login > records a probara case annotation [project=node]
passed	-	login.spec.js > login > attaches a file and a body [project=node]
passed	-	login.spec.js > login > prints to stdout and stderr [project=node]
passed	-	login.spec.js > login > accepts café and ñandú [project=node]
passed	-	login.spec.js > login > is flaky and passes on retry [project=node]
passed	PRB-14	login.spec.js > top-level test outside any describe [project=node]
Total: 13 results from 1 file (10 passed, 2 failed, 1 skipped, 0 blocked)
```

### Maven Surefire

Surefire writes one `TEST-<class>.xml` per test class into `target/surefire-reports`. Import the
folder:

```bash
mvn test
npx @probara/cli import junit target/surefire-reports
```

By default Surefire names testcases after the **methods** and ignores `@DisplayName`, so a
parameterized test becomes `usernameLength(String, int)[1]`: the key holds the index, which shifts
when you insert a case. For readable, stable names, turn on the phrased reporter (Surefire 3,
JUnit 5):

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <configuration>
    <statelessTestsetReporter implementation="org.apache.maven.plugin.surefire.extensions.junit5.JUnit5Xml30StatelessReporter">
      <usePhrasedTestCaseMethodName>true</usePhrasedTestCaseMethodName>
    </statelessTestsetReporter>
  </configuration>
</plugin>
```

- **Identity**: the classname (the fully qualified class; nested classes after `$`) and the name.
  Turning the phrased names on changes every key.
- **Linking**: `@DisplayName("SHOP-12 logs in")` with the phrased reporter, or `SHOP_12` in the
  method name. `TestReporter.publishEntry` does not reach the XML.
- **Statuses**: an `AssertionFailedError` is `<failure>`, any other exception `<error>`.
- **Reruns**: with `-Dsurefire.rerunFailingTestsCount=2`, a test that passes on a retry is
  recorded as passed, with the first failure in the notes. With reruns on, Surefire drops the
  output of passing tests.
- **Timestamps**: Surefire writes none, so no execution time is sent.

Real keys, from Surefire 3.6 and JUnit 5.14 with the phrased reporter:

<!-- output: dry-run-stdout -->

```text
$ PROBARA_PROJECT=PRB probara import junit target/surefire-reports --dry-run
failed	-	me.probara.fixture.FlakyTest > passesOnTheSecondAttempt
skipped	-	me.probara.fixture.LoginTest > supportsSso
passed	-	me.probara.fixture.LoginTest > accepts café and ñandú
failed	-	me.probara.fixture.LoginTest > crashesOnAnUnexpectedException
failed	-	me.probara.fixture.LoginTest > rejectsAWrongPassword
passed	PRB-12	me.probara.fixture.LoginTest > logs in with a valid password
passed	-	me.probara.fixture.LoginTest > printsToStdoutAndStderr
passed	-	me.probara.fixture.LoginTest > recordsAProbaraCaseEntry(TestReporter)
passed	-	me.probara.fixture.LoginTest > usernameLength(String, int) username alice has length 5
passed	-	me.probara.fixture.LoginTest > usernameLength(String, int) username bob has length 3
passed	-	me.probara.fixture.LoginTest$Session$Refresh > renewsTheTokenBeforeExpiry
Total: 11 results from 2 files (7 passed, 3 failed, 1 skipped, 0 blocked)
```

Methods without a `@DisplayName` keep their name. The two files come in path order.

### Go with gotestsum

`go test` has no JUnit output; [gotestsum](https://github.com/gotestyourself/gotestsum) writes it:

```bash
gotestsum --junitfile reports/go.xml -- ./...
npx @probara/cli import junit reports/go.xml
```

Keep the default `--junitfile-testcase-classname` (the full import path): the `short` form keys
two packages of the same name as one.

- **Identity**: the package, then the test name split on `/`:
  `example.com/shop/cart > TestCart > adds_an_item`. Go writes spaces in subtest names as `_`.
- **Parent tests**: gotestsum writes a parent test as a testcase of its own, next to its subtests.
  The CLI drops a parent that has subtests, unless it failed on its own (none of its subtests
  failed), so a failure is never lost and never counted twice.
- **Statuses**: every failure is `<failure>`; the notes hold the test's output (`=== RUN`, the
  `file.go:17:` lines and `--- FAIL`). The skip reason is taken from the `t.Skip` line.
- **Panics**: a panic ends the test binary, so the tests of that package that had not run yet are
  not in the report at all, and cannot be imported.
- **Quirks**: failures come first in the file, then skips, then passes. The output of passing tests
  is never written.
- **Timestamps**: local time with an offset: exact.

Real keys, from gotestsum 1.13 and Go 1.27:

<!-- output: dry-run-stdout -->

```text
$ PROBARA_PROJECT=PRB probara import junit reports/go.xml --dry-run
failed	-	example.com/probarafixture/auth > TestRejectsAWrongPassword
failed	-	example.com/probarafixture/auth > TestLogin > failing_subtest
skipped	-	example.com/probarafixture/auth > TestSupportsSSO
skipped	-	example.com/probarafixture/auth > TestLogin > skipped_subtest
passed	-	example.com/probarafixture/auth > TestPRB12LogsInWithAValidPassword
passed	PRB-12	example.com/probarafixture/auth > TestLogin > logs_in_with_a_valid_password
passed	-	example.com/probarafixture/auth > TestLogin > session > refresh_renews_the_token_before_expiry
passed	-	example.com/probarafixture/auth > TestLogin > accepts_café_and_ñandú
passed	-	example.com/probarafixture/auth > TestUsernameLength > alice
passed	-	example.com/probarafixture/auth > TestUsernameLength > bob
passed	-	example.com/probarafixture/auth > TestPrintsToStdoutAndStderr
failed	-	example.com/probarafixture/billing > TestCrashesOnAnUnexpectedPanic
passed	-	example.com/probarafixture/billing > TestChargesTheCard
Total: 13 results from 1 file (8 passed, 3 failed, 2 skipped, 0 blocked)
```

`TestLogin` itself is not there: it only failed because `failing_subtest` did. `TestPRB12...` is
not linked: `PRB12` has no `-` or `_`.

### Generic JUnit

Any other tool that writes JUnit XML (a `<testsuites>` or `<testsuite>` root with `<testcase>`
elements) is read as `generic`:

- **Identity**: the classname, then the name. A classname that is empty, or that the name already
  starts with, is left out.
- **Suites**: the classname. Nested `<testsuite>` elements are read too.

```xml
<testsuites>
  <testsuite name="api" timestamp="2026-09-29T14:05:00Z">
    <testcase classname="api.orders" name="lists orders" time="0.12"/>
    <testcase classname="api.orders" name="rejects an unknown order" time="0.03">
      <error message="HTTP 500">GET /orders/42 answered 500</error>
    </testcase>
    <testcase classname="" name="health check" time="0.01"/>
  </testsuite>
</testsuites>
```

<!-- dry-run: --error-status blocked -->

```text
passed	-	api.orders > lists orders
blocked	-	api.orders > rejects an unknown order
passed	-	health check
Total: 3 results from 1 file (2 passed, 0 failed, 0 skipped, 1 blocked)
```

## See also

- [Linking tests to cases](linking.md): ids in names and properties.
- [Attachments](attachments.md): files and output from the reports.
- [The automation key v1](../../core/README.md#the-automation-key-v1).
