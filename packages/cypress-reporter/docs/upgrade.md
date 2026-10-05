# Upgrading

`@probara/cypress-reporter` follows [semantic versioning](https://semver.org). Read the
[changelog](../CHANGELOG.md) before you upgrade: every change that needs an action from you is
listed there first.

## Versioning policy

- **0.x (now)**: the reporter is young. A minor version (`0.2.0`) may change options, log lines
  or defaults; a patch version (`0.1.1`) only fixes bugs. Pin the version in `package.json` (or
  keep the lockfile) and upgrade on purpose.
- **1.0 and later**: breaking changes only in a major version.
- `@probara/cypress-reporter` depends on `@probara/core` of the same release line; install the
  reporter alone and let it bring its core.

## What is a breaking change

Any of these needs a major version from 1.0 on, and a minor one before:

- An option or a `PROBARA_*` variable removed or renamed, or its meaning changed.
- A default changed (closing runs, creating missing cases, `keyIncludesFile`, what gets attached).
- A `probara.*` helper, the plugin (`@probara/cypress-reporter/setup`) or the support file
  (`@probara/cypress-reporter/support`) removed, or its behavior changed.
- A status an attempt is sent with changed for the same attempt.
- **Any change to the automation key a test gets**, with `keyIncludesFile` on or off. A different
  key unlinks the test from its case: the next run creates a new one.
- Dropping a Cypress or Node.js version that is still supported upstream.

Adding an option, a helper, a log line or a file uploaded is not breaking. `[probara]` lines are
for people: do not parse them.

## The automation key contract

The key algorithm is [automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1),
frozen in `@probara/core` and pinned by golden vectors: no version of the reporter changes it.
What the reporter adds is how a Cypress test becomes the key's parts, the way `probara import junit`
reads the JUnit report of Cypress's `junit` reporter or of cypress-junit
([keys](linking.md#automation-keys)):

- the spec file relative to Cypress's `projectRoot`, when `keyIncludesFile` is on, as the `file`
  attribute of the report's `Root Suite`;
- the full title, the describes and the `it` title joined by single spaces, as **one** segment,
  the case ids removed.

That mapping is part of the contract too: a version that changes the key of a test is a breaking
change, named as such in the changelog.

To check an upgrade, compare what both versions would send: run the suite with reporting off once
per version, each with its own results file (`PROBARA_RESULTS_FILE=before.json`, then
`after.json`, neither there beforehand), and diff what
`npx @probara/cli import results before.json --dry-run` and the same for `after.json` print
([check what would be sent](debugging.md#check-what-would-be-sent)). One file for both runs would
hide the difference: the second run writes to a sibling, and the file keeps the first run's keys.
Any changed key is a test that would get a new case.

## Cypress and Node.js versions

| Needs   | Supported                                                                 |
| ------- | ------------------------------------------------------------------------- |
| Cypress | 15.10.0 and later (the peer range); tested on 16.1.1                      |
| Node.js | 22.12 and later (the `engines` field), for the Node that starts `cypress` |

Cypress 15.10.0 is the first version with `Cypress.expose()`: the plugin hands the browser its
settings in `config.expose`, and the `probara.*` helpers of the support file read them with
`Cypress.expose('probara')`. On an older Cypress the helpers would have nothing to read, hence the
peer range.

The reporter and its plugin run in two Node.js processes:

| Process                                 | Its Node.js                                                             |
| --------------------------------------- | ----------------------------------------------------------------------- |
| The plugin (`setupNodeEvents`)          | The Node.js on your machine that starts `cypress`: 22.12 or later       |
| The reporter (`reporter` in the config) | The Node.js bundled in Cypress: 22.19 in Cypress 15.10, 24.15 in 16.1.1 |

Cypress 15 still runs on Node.js 20; this reporter does not, so a project on Cypress 15 and Node.js
20 has to upgrade Node.js first.

## 0.x notes

- **0.1.0** is the first version: nothing to migrate from. Coming from `probara import junit` on
  the report of Cypress's `junit` reporter or of cypress-junit, see
  [migrating from JUnit](migrating-from-junit.md); from Qase, see
  [migrating from Qase](migrating-from-qase.md); from Allure or TestRail, see
  [coming from other tools](coming-from-other-tools.md).

## See also

- [Changelog](../CHANGELOG.md).
- [Linking tests to cases](linking.md#automation-keys).
