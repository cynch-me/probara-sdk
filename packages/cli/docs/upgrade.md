# Upgrading

`@probara/cli` follows [semantic versioning](https://semver.org). Read the
[changelog](../CHANGELOG.md) before you upgrade: every change that needs an action from you is
listed there first.

## Versioning policy

- **0.x (now)**: the CLI is young. A minor version (`0.3.0`) may change flags, output or
  defaults; a patch version (`0.2.1`) only fixes bugs. Pin the version in CI
  (`npx @probara/cli@0.2.0`, or a lockfile) and upgrade on purpose.
- **1.0 and later**: breaking changes only in a major version.

## What is a breaking change

Any of these needs a major version from 1.0 on, and a minor one before:

- A flag, a command or an environment variable removed or renamed, or its meaning changed.
- A default changed (for example, closing runs or creating missing cases).
- An exit code that means something else, or a situation that exits with another code.
- A change to the `--json` documents that removes or renames a field, or to the dry-run lines.
- **Any change to the automation key a report gives.** A different key unlinks the test from its
  case: the next import creates a new one.

Adding a flag, a field in `--json`, a dialect, or a log line is not breaking. Log lines on stderr
are for people: do not parse them, use `--json`.

## The automation key contract

The key algorithm itself is [automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1), frozen
in `@probara/core` and pinned by golden vectors: no version of the CLI changes it. What the CLI
adds is how each dialect turns a testcase into the key's parts (file, title path, parameters). That
mapping is part of the contract too: a version that changes the key of a report you already
imported is a breaking change, named as such in the changelog, with the reports it affects.

To check an upgrade, compare the keys of the same report with both versions:

```bash
probara import junit "reports/**/*.xml" --dry-run > keys-before.txt
```

Run it again with the new version and `diff` the files: any changed line is a test that would get
a new case.

## Node.js versions

The CLI supports the Node.js versions in its `engines` field (22.12 and later). Dropping a Node
version that is still maintained upstream is a breaking change.

## See also

- [Changelog](../CHANGELOG.md).
- [Linking tests to cases](linking.md#what-keeps-a-key-and-what-changes-it).
