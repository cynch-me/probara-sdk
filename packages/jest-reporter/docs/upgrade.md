# Upgrading

`@probara/jest-reporter` follows [semantic versioning](https://semver.org). Read the
[changelog](../CHANGELOG.md) before you upgrade: every change that needs an action from you is
listed there first.

## Versioning policy

- **0.x (now)**: the reporter is young. A minor version (`0.2.0`) may change options, log lines
  or defaults; a patch version (`0.1.1`) only fixes bugs. Pin the version in `package.json` (or
  keep the lockfile) and upgrade on purpose.
- **1.0 and later**: breaking changes only in a major version.
- `@probara/jest-reporter` depends on `@probara/core` of the same release line; install the
  reporter alone and let it bring its core.

## What is a breaking change

Any of these needs a major version from 1.0 on, and a minor one before:

- An option or a `PROBARA_*` variable removed or renamed, or its meaning changed.
- A default changed (closing runs, creating missing cases, `keyIncludesFile`, what gets attached).
- A `probara.*` helper or the setup file removed, or its behavior changed.
- A status an attempt is sent with changed for the same attempt.
- **Any change to the automation key a test gets**, with `keyIncludesFile` on or off. A different
  key unlinks the test from its case: the next run creates a new one.
- Dropping a Jest or Node.js version that is still supported upstream.

Adding an option, a helper, a log line or a file uploaded is not breaking. Log lines on stderr are
for people: do not parse them.

## The automation key contract

The key algorithm is [automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1),
frozen in `@probara/core` and pinned by golden vectors: no version of the reporter changes it.
What the reporter adds is how a Jest test becomes the key's parts, the way `probara import junit`
reads the report of jest-junit with its default templates ([keys](linking.md#automation-keys)):

- the test file relative to `rootDir` (the real path of the directory `jest` runs in), when
  `keyIncludesFile` is on, as jest-junit writes it with `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`;
- the describes and the title, joined by spaces and split on `›` (with its spaces), the case ids
  removed;
- `{displayName}` in a describe or a title filled with the Jest project's name, and `$` patterns
  (`$$`, `$&`) expanded, as jest-junit's templates do.

That mapping is part of the contract too: a version that changes the key of a test is a breaking
change, named as such in the changelog.

To check an upgrade, compare what both versions would send: run the suite with reporting off once
per version, each with its own results file (`PROBARA_RESULTS_FILE=before.json`, then
`after.json`, neither there beforehand), and diff what
`npx @probara/cli import results before.json --dry-run` and the same for `after.json` print
([check what would be sent](debugging.md#check-what-would-be-sent)). One file for both runs would
hide the difference: the second run writes to a sibling, and the file keeps the first run's keys.
Any changed key is a test that would get a new case.

## Jest and Node.js versions

| Needs    | Supported                                                                   |
| -------- | --------------------------------------------------------------------------- |
| `jest`   | 29.6 and later (the peer range): tested on 29.7 and the latest 30           |
| Node.js  | 22.12 and later (the `engines` field)                                       |
| A runner | jest-circus, Jest's default, for the `probara.*` helpers and the setup file |

Jest 29.6 is the first version that tells a reporter when each test starts, hence the peer range.
Some details depend on the version:

| Jest           | What changes                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29             | A `test.todo` or skipped test gets the start time of its file. `jest.retryTimes` never retries a `test.concurrent` test                                          |
| 30.0 to 30.4   | A `test.concurrent` test retried by `jest.retryTimes`: the `probara.*` calls of its retries join those of its first attempt (Jest 30.5 tells each attempt apart) |
| 30.5 and later | Every attempt of every test, `test.concurrent` included, gets its own `probara.*` calls                                                                          |

Under `testRunner: 'jest-jasmine2'` the tests are reported, but the `probara.*` calls record
nothing (the first one warns), `captureOutput` attaches nothing, and `runCasesOnly` runs and
reports every test, with a warning ([troubleshooting](troubleshooting.md#the-helpers-record-nothing)).

## 0.x notes

- **0.1.0** is the first version: nothing to migrate from. Coming from `probara import junit` on
  jest-junit's report, see [migrating from JUnit](migrating-from-junit.md); from Qase, see
  [migrating from Qase](migrating-from-qase.md); from Test IT, ReportPortal, Allure or TestRail,
  see [coming from other tools](coming-from-other-tools.md).

## See also

- [Changelog](../CHANGELOG.md).
- [Linking tests to cases](linking.md#automation-keys).
