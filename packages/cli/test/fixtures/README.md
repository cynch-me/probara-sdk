# JUnit XML fixtures

Every XML file here is tool output, then only the scripted string replacements of `sanitize.mjs`.
Nobody wrote or edited them by hand. Each
`<dialect>/source/` folder holds the small project that produced the XML, and each
`<dialect>/generate.sh` holds the exact commands and tool versions to regenerate it. Use them as
parser inputs for `@probara/cli`. They reflect what each tool really emits, quirks included.

## Quick path

1. Pick a dialect folder. Its `junit*.xml` (or `surefire-reports*/`) are the inputs.
2. To regenerate, install the listed tool versions and run `<dialect>/generate.sh`.
3. `generate.sh` ends by running `sanitize.mjs`. Expect diffs only in times and timestamps.
   Structure stays stable.

## Common scenario

Every dialect covers the same scenario, adapted to its idiom:

- a pass, a failed assertion and an unexpected exception or panic
- a skip with a reason
- nested groups
- a parameterized test with 2 cases
- a `PRB-12` token in a title and, where the dialect allows it, a `probara_case=PRB-13` property
- stdout and stderr output
- the unicode title `accepts café and ñandú`

## Sanitization: tool output, then only these string replacements

The repository is public, so machine-specific strings are rewritten by a script, never by hand.
Every `generate.sh` finishes with `node ../../sanitize.mjs <dialect> "$PWD"`. It needs plain Node
and no dependencies. It rewrites, in place, every `.xml`, `.txt` and `.md` file under `<dialect>/`
except `source/`.

| Found in the output | Replaced with | Value taken from |
|---|---|---|
| each `<workdir>` prefix given as an argument (plus realpath and macOS `/private` variants) | `/work/<dialect>` (the rest of the path is kept) | arguments, longest first |
| the temp dir | `/tmp` | `os.tmpdir()` |
| the home dir | `/home/runner` | `os.homedir()` |
| the Homebrew prefix | `/usr/local` | `$HOMEBREW_PREFIX` (default: the Apple Silicon prefix) |
| the hostname (full, then short) | `ci-host` | `os.hostname()` |
| the username | `runner` | `os.userInfo().username` |

Only whole literal substrings are replaced. Element structure, attribute order, entities and
relative paths such as `[[ATTACHMENT|test-results/...]]` are untouched, so every XML still parses
and every attachment reference still resolves.

The files committed today were generated from a scratch copy of each `source/`, with `node_modules`
shared from a scratch install. They were sanitized with those work dirs as arguments. Stack paths
therefore read like `/work/jest/src/__tests__/login.test.js` and
`/work/jest/node_modules/jest-circus/...`. Remaining values are genuine but generic: the JDK and
Go versions, Surefire's JVM property names, and the `/usr/local/Cellar/go/...` GOROOT.

## At a glance

| Dialect | Tool + version | Root | One file per | Failure vs error | stdout/stderr | Properties | Timestamp |
|---|---|---|---|---|---|---|---|
| jest | jest 30.5.2 + jest-junit 17.0.0 | `testsuites` | run | always `<failure>` | none by default; opt-in suite-level JSON | none | `2026-09-29T18:47:16` (UTC, **no offset**) |
| pytest | pytest 8.4.2 (CPython 3.9.6) | `testsuites` | run | `<failure>` in test body, `<error>` in setup/teardown | none by default; `junit_logging=all` gives per-testcase output | per-testcase `record_property` | `2026-09-29T13:48:02.212815-05:00` (local + offset) |
| playwright | @playwright/test 1.63.0 | `testsuites` (no XML declaration) | run | `<failure>` for expect, `<error>` for thrown errors | per-testcase CDATA | per-testcase annotations | `2026-09-29T18:49:25.039Z` (UTC `Z`) |
| surefire | Maven 3.9.11, surefire 3.6.0, JUnit 5.14.4, JDK 24 | `testsuite` | **test class** (multi-file) | `<failure>` for AssertionFailedError, `<error>` for other throwables | per-testcase CDATA (see rerun quirk) | suite-level JVM system props only | **none** |
| gotestsum | gotestsum v1.13.0, go 1.27.1 | `testsuites` | run | always `<failure>` | **never** (only inside failure/skip text) | suite-level `go.version` | `2026-09-29T13:51:54-05:00` (local + offset) |

---

## jest (jest-junit)

Files:

- `junit.xml`: default options.
- `junit-add-file-attribute.xml`: `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`.
- `junit-include-console-output.xml`: adds `JEST_JUNIT_INCLUDE_CONSOLE_OUTPUT=true`.

Regenerate with `jest/generate.sh`, which also lists every `JEST_JUNIT_*` env option and its
default.

- **Root.** `<testsuites name="jest tests" tests failures errors time>`, then one
  `<testsuite name errors failures skipped timestamp time tests>` per test **file**. No hostname,
  no id.
- **Suite name.** The template is `{title}`, the file's first top-level `describe`. A file without
  a `describe` gets `name="undefined"` (literally).
- **Testcase.** Attributes are `classname`, `name` and `time`, plus `file` only with
  `addFileAttribute`. The file path is relative to jest `rootDir`, for example
  `src/__tests__/login.test.js`.
- **Classname duplicates name.** Both templates default to `{classname} {title}`, so both
  attributes hold the same string: the ancestor describes plus the title, joined by a space. For
  example: `login session refresh renews the token before expiry`.
- **Top-level test names.** A test outside any `describe` gets a **leading space**:
  `" [PRB-13] top-level test outside any describe"`.
- **Parameters.** `test.each` bakes the values into the title (`username alice has length 5`).
  There is no separate parameter encoding.
- **Failure.** Assertions and thrown exceptions both become a bare `<failure>` with no `message`
  or `type` attributes. The body is the error text plus the stack (absolute paths). Suite
  `errors` is always 0.
- **Skipped.** `<skipped/>` with no message. `test.skip` has no reason argument, so any reason
  can only live in the title.
- **Output.** Nothing by default. With `includeConsoleOutput`, the suite gets one `<system-out>`
  CDATA holding a JSON array of `{message, origin, type: "log"|"error"}` from `console.*`.
  `console.error` also lands there, and there is no `<system-err>`. Raw
  `process.stdout.write`/`process.stderr.write` is not captured.
- **Properties and attachments.** None. jest-junit supports properties only through a user-written
  `junitTestCaseProperties.js`, which this fixture does not use.

## pytest

Files:

- `junit.xml`: defaults (`junit_family=xunit2`, `junit_logging=no`).
- `junit-logging-all.xml`: `-o junit_logging=all`.
- `junit-xunit1.xml`: `-o junit_family=xunit1`.

Regenerate with `pytest/generate.sh`.

- **Root.** `<testsuites name="pytest tests">` holds a single
  `<testsuite name="pytest" errors failures skipped tests time timestamp hostname>`. The file is
  written on one line with no pretty-printing.
- **Testcase.** Attributes are `classname`, `name` and `time` (3 decimals). xunit1 adds `file`
  (relative to rootdir) and `line`, which is **0-based**: `line="5"` points at a `def` on line 6.
- **Classname.** The dotted module path relative to rootdir, followed by the class chain for
  nested groups. For example: `tests.test_login.TestSession.TestRefresh`.
- **Name.** The function name. A parameterized test becomes `test_username_length[alice-5]`.
  Non-ASCII **parameter ids are escaped**, for example
  `test_unicode_parameter_ids[PRB-14 accepts caf\xe9]`. A unicode **function** name stays raw:
  `test_accepts_café_and_ñandú`.
- **Failure.** Raised in the test body, an assertion or an unexpected exception (TypeError) both
  give `<failure message="<ExcType>: <msg>">`. The body is pytest's traceback with a relative
  path. There is no `type` attribute.
- **Error.** Raised in a fixture during setup, it gives
  `<error message="failed on setup with &quot;ConnectionError: ...&quot;">`.
- **Skipped.** `<skipped type="pytest.skip" message="<reason>">`. The body is
  `<absolute path>:<line>: <reason>`.
- **Properties.** `record_property("probara_case", "PRB-13")` gives a per-testcase
  `<properties><property name value/></properties>`. It works under xunit2.
- **Output.** Nothing under `junit_logging=no`. With `all`, every testcase gets `<system-out>`
  (sections `Captured Log` and `Captured Out`) and `<system-err>` (`Captured Err`), each with
  banner lines, even when they are empty. A skipped test gets the pair **twice**.

## Playwright (junit reporter)

Files:

- `junit.xml`: default reporter options.
- `junit-include-retries.xml`: `PLAYWRIGHT_JUNIT_INCLUDE_RETRIES=1` and
  `PLAYWRIGHT_JUNIT_INCLUDE_PROJECT_IN_TEST_NAME=1`.
- `test-results/`: the attachments the XML references, at the paths it expects.

The config uses `retries: 1` and one project named `node`. The tests never use `page`, so no
browser is needed. Regenerate with `playwright/generate.sh`.

- **Root.** `<testsuites id="" name="" tests failures skipped errors time>`. There is **no
  `<?xml?>` declaration**. Each spec **file** gets one
  `<testsuite name timestamp hostname tests failures skipped time errors>`.
- **Hostname.** `hostname` holds the **project name** (`node`), not a machine name.
- **Suite name.** The spec path relative to `testDir` (`login.spec.js`).
- **Testcase.** Attributes are `name`, `classname` (= the same file path) and `time`. There is no
  `file` attribute, and a skipped testcase has **no `time`**.
- **Name.** The describe chain and the title joined by `" › "` (U+203A with spaces), for example
  `login › session › refresh › renews the token before expiry`. Root, project and file are
  excluded. `includeProjectInTestName` prefixes `[node] `. Parameterized tests are loop-generated
  titles.
- **Failure and error.** An `expect` failure gives `<failure message type="expect.toBe">`. A thrown
  error gives `<error message type="TypeError">`. The CDATA body is Playwright's formatted report,
  covering **every attempt** (`Retry #1` section) with a code frame and an absolute path.
- **Skipped.** `<skipped>` has no attributes. The reason is emitted as
  `<property name="skip" value="SSO provider not configured">`.
- **Flaky (default).** Reported as a plain pass. The only trace is the first attempt's
  `error-context.md` attachment in `system-out`. The time is the sum of all attempts.
- **Flaky (includeRetries).** The testcase gets `<flakyFailure message type time>` children, each
  with `<stackTrace>` and `<system-out>`. A failing test gets `<rerunFailure>`/`<rerunError>`
  siblings, and its main time is the first attempt's.
- **Properties.** Each annotation (`test.info().annotations.push`, or the `annotation` test option)
  becomes `<property name="<type>" value="<description>">`. For example: `probara_case=PRB-13` and
  `issue=https://...`. Tags (`@smoke`) are **not** emitted.
- **Attachments.** Only path-based attachments appear, as `[[ATTACHMENT|<path>]]` lines inside
  `<system-out>`. The path is relative to the XML file's directory, for example
  `test-results/<test-dir>/attachments/screenshot-<sha1>.png`. Playwright copies the file under a
  content-hash name, so the attachment name is lost. **Body attachments (`{ body }`) are silently
  dropped.** Failed tests also get auto `error-context.md` attachments.
- **Output.** Per-testcase `<system-out>`/`<system-err>` CDATA. `console.*` and raw
  `process.stdout`/`process.stderr` writes are both captured.

## Maven Surefire (JUnit 5)

Folders:

- `surefire-reports/`: default reporter, no reruns.
- `surefire-reports-rerun/`: `rerunFailingTestsCount=2`, via profile `-Prerun`.
- `surefire-reports-phrased/`: JUnit 5 display names, via profile `-Pphrased`.

Each folder holds `TEST-<fqcn>.xml` plus `<fqcn>.txt`, one pair per **top-level** test class.
`@Nested` classes land in the enclosing class's file. Regenerate with `surefire/generate.sh`.

- **Root.** `<testsuite xmlns:xsi xsi:noNamespaceSchemaLocation version="3.0.2" name="<fqcn>" time tests errors skipped failures flakes>`.
  There is no `testsuites` wrapper, no `timestamp` and no `hostname`.
- **Properties.** A ~59-entry `<properties>` block of JVM system properties. There is none per
  testcase. `TestReporter.publishEntry("probara_case", ...)` is **not** emitted anywhere.
- **Testcase.** Attributes are `name`, `classname` (FQCN) and `time` (like `0.001`, or `0.0`).
- **Default names.** Names are **method names**, and `@DisplayName` is ignored. A parameterized
  test becomes `usernameLength(String, int)[1]`. A method with injected parameters keeps its
  signature: `recordsAProbaraCaseEntry(TestReporter)`. Nested classes use a `$` classname:
  `me.probara.fixture.LoginTest$Session$Refresh`.
- **Phrased names.** Display names are used for `name`:
  `PRB-12 logs in with a valid password`, `accepts café and ñandú` and
  `usernameLength(String, int) username alice has length 5`. The nested classname keeps `$`.
- **Failure and error.** `<failure message type="org.opentest4j.AssertionFailedError">` or
  `<error message type="java.lang.NullPointerException">`. The body is a CDATA stack trace.
- **Skipped.** `<skipped message="<@Disabled reason>"/>`.
- **Output.** `<system-out>`/`<system-err>` are per testcase. Without reruns, passing tests keep
  them. **With reruns enabled, passing tests lose their output**, and it only appears for
  failing, rerun or flaky attempts.
- **Reruns.** A still-failing test keeps its main `<failure>`/`<error>` and then gets one
  `<rerunFailure>`/`<rerunError>` per extra attempt, each with `<stackTrace>`. A test that passes
  on retry gets `<flakyFailure message type>` with `<stackTrace>` and `<system-out>` children, and
  the suite shows `flakes="1"`, `failures="0"`.

## gotestsum

Files:

- `junit.xml`: defaults.
- `junit-short-names.xml`: `--junitfile-testsuite-name=short`,
  `--junitfile-testcase-classname=short` and `--junitfile-project-name`.

The source has two packages: `auth` and `billing` (the panic). Regenerate with
`gotestsum/generate.sh`.

- **Root.** `<testsuites tests failures errors time>`, which gets `name` only with
  `--junitfile-project-name`. Each **package** gets one
  `<testsuite tests failures skipped time name timestamp>`, and `skipped` is omitted when it is 0.
  Tabs are used for indentation.
- **Suite name.** The full import path (`example.com/probarafixture/auth`), or `auth` with `short`.
- **Properties.** One per suite: `go.version`.
- **Testcase.** Attributes are `classname` (= the package import path, or the short form),
  `name` and `time` (6 decimals).
- **Name.** Go's test name, with subtests joined by `/` and **spaces turned into `_`**. For
  example: `TestLogin/PRB-12_logs_in_with_a_valid_password` and
  `TestLogin/accepts_café_and_ñandú`. A table-driven case becomes `TestUsernameLength/alice`.
- **Parents are separate testcases.** Parent tests appear as their own testcases next to their
  subtests (`TestLogin`, `TestLogin/session`). A parent of a failing subtest is itself a failure.
- **Order.** Failures come first, then skips, then passes. This is not source order.
- **Failure.** Always `<failure message="Failed" type="">`. The body is the raw `go test` output
  for that test (`=== RUN`, `file.go:17: ...` lines and `--- FAIL`).
- **Panic.** A failure on the panicking test with the full goroutine trace. The **rest of that
  package never runs and is absent** (`TestNeverRunsAfterThePanic` is missing, and `tests="2"`).
- **Skipped.** `<skipped message="...">`, where the *attribute* holds the whole `=== RUN` /
  `file.go:22: <reason>` / `--- SKIP` output. There is no body.
- **Output.** No `system-out`/`system-err` at all. Output of passing tests (`fmt.Println`,
  `os.Stderr`, `t.Log`) is dropped.
- **Properties and attachments.** No per-testcase properties or attachments are possible.
