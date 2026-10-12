# Upgrading

`@probara/vitest-reporter` follows [semantic versioning](https://semver.org): read the
[changelog](../CHANGELOG.md) before you upgrade it. A new Vitest major can change the names it gives
tests, and so their automation keys: before you upgrade Vitest, read
[from Vitest 4 to 5](#from-vitest-4-to-5) and [compare the keys](#the-automation-key-contract).

## Versioning policy

- **0.x (now)**: the reporter is young. A minor version (`0.2.0`) may change options, log lines
  or defaults; a patch version (`0.1.1`) only fixes bugs. Pin the version in `package.json` (or
  keep the lockfile) and upgrade on purpose.
- **1.0 and later**: breaking changes only in a major version.
- `@probara/vitest-reporter` depends on `@probara/core` of the same release line; install the
  reporter alone and let it bring its core.

## What is a breaking change

Any of these needs a major version from 1.0 on, and a minor one before:

- An option or a `PROBARA_*` variable removed or renamed, or its meaning changed.
- A default changed (closing runs, creating missing cases, `keyIncludesFile`, what gets attached).
- A `probara.*` helper removed, or its behavior changed.
- A status an attempt is sent with changed for the same attempt.
- **Any change to the automation key a test gets**, with `keyIncludesFile` on or off. A different
  key unlinks the test from its case: the next run creates a new one.
- Dropping a Vitest or Node.js version that is still supported upstream.

Adding an option, a helper, a log line or a file uploaded is not breaking. Log lines on stderr are
for people: do not parse them.

## The automation key contract

The key algorithm is [automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1),
frozen in `@probara/core` and pinned by golden vectors: no version of the reporter changes it.
What the reporter adds is how a Vitest test becomes the key's parts, the way `probara import junit`
reads Vitest's JUnit output ([keys](linking.md#automation-keys)):

- the test file relative to `rootDir` (the Vitest root), when `keyIncludesFile` is on;
- the `describe` titles and the test title, each a part, as Vitest's JUnit output names them, the
  case ids removed;
- a `test.each` or `test.for` row by the title Vitest formats for it.

That mapping is part of the contract too: a version of the reporter that changes the key of a test
is a breaking change, named as such in the changelog. A version of Vitest that formats titles
differently changes keys as well (below), for the reporter and for `probara import junit` alike.

To check an upgrade of either, compare what both versions would send: run the suite with reporting
off once per version, each with its own results file, and diff the dry runs
([check what would be sent](debugging.md#check-what-would-be-sent)). Any changed key is a test that
would get a new case.

## Vitest and Node.js versions

| Needs        | Supported                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `vitest`     | 3.2 and later (the peer range `^3.2.0 \|\| ^4.0.0 \|\| ^5.0.0`): tested on 3.2.7, 4.1.11, 5.0.2 |
| Browser mode | The provider of your `vitest` version: tested on 3.2.7, 4.0.18, 4.1.11 and 5.0.2                |
| Node.js      | 22.12 and later (the `engines` field)                                                           |

Vitest 3.2 is the first version with test annotations, which the reporter reads, hence the peer
range. Browser mode has its own setup per Vitest line ([browser mode](browser-mode.md)).

## From Vitest 4 to 5

**Some `test.each` and `test.for` titles change**, and with them their keys. Vitest 5 formats the
values it puts in a title in another way:

| The test                                                        | Vitest 3 and 4                                                        | Vitest 5                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| `test.each([{ name: 'Ana' }])('greets $name')`                  | `greets 'Ana'`                                                        | `greets Ana`                                     |
| `test.each([{ note }])('saves $note')`, a note of 48 characters | `saves 'Leave the parcel with the neighbour a…'`                      | `saves Leave the parcel with the neighbour at …` |
| `test.each([[{ note }]])('stores %o')`                          | `stores { note: 'Leave the parcel with the neighbour at number 12' }` | `stores { …(1) }`                                |
| `test.each([[new Map([['eur', 12]])]])('reads %o')`             | `reads Map{ 'eur' => 12 }`                                            | `reads Map { 'eur' => 12 }`                      |
| Numbers, short objects and arrays, `%s` of a string             | The same                                                              | The same                                         |

The keys of those rows, as Vitest 5 names them:

<!-- project: each-titles -->

```ts
// tests/rows.test.ts
import { test } from 'vitest';

const note = 'Leave the parcel with the neighbour at number 12';

test.each([{ name: 'Ana' }])('greets $name', () => {});

test.each([[{ note }]])('stores %o', () => {});
```

<!-- sent: each-titles -->

```json
[
  { "automationKey": "tests/rows.test.ts > greets Ana" },
  { "automationKey": "tests/rows.test.ts > stores { …(1) }" }
]
```

- **A changed key is a new case.** The old case keeps its history, and the new key's results go to
  a new case. Compare the keys before you upgrade, as above: each changed line is such a row.
- **Rows can collide.** `{ …(1) }` stands for any object of one key that is too long to print, so
  two such rows get the same title and share one case. Put a short value of each row in its title
  (`'stores $id'`).
- **`probara import junit` changes the same way**: it reads the names Vitest 5 writes in its JUnit
  output, so both paths keep giving a test the same key.
- **The default `attachmentsDir` moves** from `.vitest-attachments` to `.vitest/attachments`: a CI
  job that carries it with the blobs, or cleans it, needs the new path
  ([where the copies are kept](attachments.md#where-the-copies-are-kept)).

## From Vitest 3 to 4

- **Browser mode** has a new provider package, `@vitest/browser-playwright`, with
  `provider: playwright()` ([browser mode](browser-mode.md)).
- **Vitest tags** (4.1 and later) join the tags of the cases a report creates; Vitest refuses a tag
  its config does not declare ([Vitest tags](metadata.md#vitest-tags)).
- **Text bodies of `context.annotate()`** need `bodyEncoding: 'utf-8'` from Vitest 4.1.3 on: Vitest
  labels a body base64 otherwise ([Vitest annotations](attachments.md#vitest-annotations)).

## Any upgrade of a sharded pipeline

`vitest --merge-reports` reads only the blobs of its own Vitest version: upgrade the shards and the
merge job together, in one change of the pipeline.

## 0.x notes

- **0.1.0** is the first version: nothing to migrate from. Coming from `probara import junit` on
  Vitest's JUnit output, the keys stay the same
  ([the same keys as `probara import junit`](linking.md#the-same-keys-as-probara-import-junit)).

## See also

- [Changelog](../CHANGELOG.md).
- [Linking tests to cases](linking.md#automation-keys).
