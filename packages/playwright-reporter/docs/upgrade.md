# Upgrading

`@probara/playwright-reporter` follows [semantic versioning](https://semver.org). Read the
[changelog](../CHANGELOG.md) before you upgrade: every change that needs an action from you is
listed there first.

## Versioning policy

- **0.x (now)**: the reporter is young. A minor version (`0.2.0`) may change options, log lines
  or defaults; a patch version (`0.1.1`) only fixes bugs. Pin the version in `package.json` (or
  keep the lockfile) and upgrade on purpose.
- **1.0 and later**: breaking changes only in a major version.
- `@probara/playwright-reporter` depends on `@probara/core` of the same release line; install the
  reporter alone and let it bring its core.

## What is a breaking change

Any of these needs a major version from 1.0 on, and a minor one before:

- An option or a `PROBARA_*` variable removed or renamed, or its meaning changed.
- A default changed (closing runs, creating missing cases, what gets attached).
- A `probara.*` helper removed, or its behavior changed.
- A status an attempt is sent with changed for the same attempt.
- **Any change to the automation key a test gets.** A different key unlinks the test from its
  case: the next run creates a new one.
- Dropping a Playwright or Node.js version that is still supported upstream.

Adding an option, a helper, a log line or a file uploaded is not breaking. Log lines on stderr are
for people: do not parse them.

## The automation key contract

The key algorithm is [automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1),
frozen in `@probara/core` and pinned by golden vectors: no version of the reporter changes it.
What the reporter adds is how a Playwright test becomes the key's parts (the file relative to
`rootDir`, the describes and the title, the project), the same way `probara import junit` reads
Playwright's JUnit XML ([keys](linking.md#automation-keys)). That mapping is part of the contract
too: a version that changes the key of a test is a breaking change, named as such in the changelog.

To check an upgrade, compare what both versions would send: run the suite with reporting off once
per version, each with its own results file (`PROBARA_RESULTS_FILE=before.json`, then
`after.json`, neither there beforehand), and diff what
`npx @probara/cli import results before.json --dry-run` and the same for `after.json` print
([check what would be sent](debugging.md#check-what-would-be-sent)). One file for both runs would
hide the difference: the second run writes to a sibling, and the file keeps the first run's keys.
Any changed key is a test that would get a new case.

## Playwright and Node.js versions

| Needs              | Supported                                                      |
| ------------------ | -------------------------------------------------------------- |
| `@playwright/test` | 1.42 and later (the peer range): tested on 1.42 and the latest |
| Node.js            | 22.12 and later (the `engines` field)                          |

Some features depend on the Playwright version: files of steps and skipped steps need 1.50, and
the error context of a failed attempt needs 1.51 ([steps](steps.md#playwright-versions)). Nothing
fails on an older Playwright of the range: those details are just not there.

## 0.x notes

- **0.1.0** is the first version: nothing to migrate from. Coming from `probara import junit`, see
  [the same keys](linking.md#the-same-keys-as-probara-import-junit); from Qase, see
  [migrating from Qase](migrating-from-qase.md).

## See also

- [Changelog](../CHANGELOG.md).
- [Linking tests to cases](linking.md#automation-keys).
