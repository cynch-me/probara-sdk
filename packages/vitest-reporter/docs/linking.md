# Linking tests to cases

Each result goes to a Probara test case. A test that names its case is linked to it; a test that
names none is matched by its automation key, and its case is created the first time it is reported.
Link tests when their cases already exist in Probara (written by hand, or imported).

## Two ways to name a case

| Way                                     | Example                                           | When                                       |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| A case id in a test or `describe` title | `test('SHOP-12 pays with a card', ...)`           | The usual way; works for skipped tests too |
| `probara.id()` in the test              | `probara.id('SHOP-14')`, `probara.id(['A', 'B'])` | Ids known only while the test runs         |

<!-- project: linking -->

```ts
// tests/checkout.test.ts
import { probara } from '@probara/vitest-reporter';
import { describe, test } from 'vitest';

describe('checkout', () => {
  test('SHOP-12 pays with a card', () => {});

  describe('SHOP-13 vouchers', () => {
    test('pays with a voucher', () => {});
  });

  test('pays with a gift card', () => {
    probara.id('SHOP-14');
  });

  test('shows the total', () => {
    // No case named: matched by its key, created the first time.
  });
});
```

Probara receives one result per test, each with its case, and the key it would get without the
ids:

<!-- sent: linking -->

```json
[
  {
    "caseDisplayId": "SHOP-12",
    "automationKey": "tests/checkout.test.ts > checkout > pays with a card"
  },
  {
    "caseDisplayId": "SHOP-13",
    "automationKey": "tests/checkout.test.ts > checkout > vouchers > pays with a voucher"
  },
  {
    "caseDisplayId": "SHOP-14",
    "automationKey": "tests/checkout.test.ts > checkout > pays with a gift card"
  },
  { "automationKey": "tests/checkout.test.ts > checkout > shows the total" }
]
```

- **Title ids** are the ids of the reported project (and of the projects `projects` lists) in a
  `describe` or test title, as `SHOP-12` or `SHOP_12`, anywhere in it, also in brackets
  (`[SHOP-12]`) or after `@`. An id in a `describe` links every test inside it. They are removed
  from the key, so adding one never changes a key. An id of a project the reporter does not know
  stays in the title and the key, as text.
- **`probara.id()`** takes an id or a list, and links the running attempt. A test skipped before it
  runs (`test.skip`, a skipped `describe`, `test.todo`) never runs its body: link it with a title id
  instead. `runCasesOnly` does not see `probara.id()` either: it decides before the test runs.

The ids are the case's display id: the project code, a dash and the number shown in Probara
(`SHOP-12`). An id Probara does not know is not recorded: the log counts it as unmatched.

## Several cases

Every source counts: `probara.id()` first (in call order), then the ids of the titles, each id
once. A test linked to several cases is sent once per case, with the same key, its files uploaded
to each result:

<!-- project: several -->

```ts
// tests/login.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('SHOP-21 logs in', () => {
  probara.id('SHOP-20');
});
```

<!-- sent: several -->

```json
[
  { "caseDisplayId": "SHOP-20", "automationKey": "tests/login.test.ts > logs in" },
  { "caseDisplayId": "SHOP-21", "automationKey": "tests/login.test.ts > logs in" }
]
```

## Automation keys

A test that names no case is matched by its automation key: the same key finds the same case on
every run, and a new key creates a new case. The key is the one
[`probara import junit`](#the-same-keys-as-probara-import-junit) gives the test in Vitest's JUnit
output:

| Part | From                                                                                                       | Example                  |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| File | The test file, relative to the Vitest root (`root`, the directory `vitest` runs in by default)             | `tests/checkout.test.ts` |
| Name | The `describe` titles and the test title, each a segment, as Vitest's JUnit output names them; ids removed | `checkout > pays`        |

So `tests/checkout.test.ts > checkout > pays` is the key of `test('pays')` inside
`describe('checkout')`. The key algorithm is
[automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1)
of `@probara/core`, frozen and shared by every Probara tool.

What changes a key, and so creates a new case: renaming a test, a `describe` or a file, moving a
file, running `vitest` with another root (the file is relative to it; set `rootDir` to keep it), or
changing `keyIncludesFile`. What does not: adding or removing a case id, `probara.title()` and
`probara.suite()` (they only name the case a report creates), `probara.parameters()`, Vitest tags,
the Vitest project that runs the test, a retry or a repeat, and the CI.

### Without the file

`keyIncludesFile: false` (`PROBARA_KEY_INCLUDES_FILE=false`) leaves the file out of every key:
`checkout > pays`. Use it when your cases already have keys without the file, made by hand or by
another tool, so each test keeps its case. A test then gets the same key as a test with the same
`describe` blocks and title in another file.

<!-- project: without-file -->

```ts
reporters: ['default', ['@probara/vitest-reporter', { keyIncludesFile: false }]],
```

<!-- sent: without-file -->

```json
[
  { "automationKey": "cart > adds an item", "caseDisplayId": "SHOP-12" },
  { "automationKey": "cart > removes an item" },
  { "automationKey": "login > logs in with a valid password" }
]
```

Changing `keyIncludesFile` changes every key: tests that name no case in their titles then create
new cases. A case the report creates goes in a suite named after the test file, or, with
`keyIncludesFile: false`, after its outermost `describe`, when it has one. Vitest's JUnit output
always names the file, so the keys of `probara import junit` on it are those of the default,
`keyIncludesFile: true`.

### Names as Vitest writes them

The name is the one Vitest's JUnit output gives the test, so a key never depends on which of the two
tools reported it:

- **`test.each` and `test.for`** rows are tests of their own, named with their values (`%s`, `%i`,
  `$name`): each row is a case. Rows that get the same name (no placeholder in the title) share one
  key, and record into the same case. Vitest 5 writes an object value (`%o`, `$user`) differently
  from Vitest 3 and 4, so the keys of such rows change when you upgrade to it.
- **`>`** (`>` with a space on each side) in a title splits it into two segments, as Vitest's
  JUnit output and the import read it: the key is the same string either way.
- **Vitest projects** add nothing to the key, as with the JUnit import: a test file two projects run
  is reported once per project, under the same key, each result with its `project` parameter.

<!-- project: names -->

```ts
// tests/prices.test.ts
import { describe, test } from 'vitest';

describe('prices', () => {
  test.each([
    ['EUR', '€'],
    ['USD', '$'],
  ])('shows %s as %s', () => {});

  test('discount > applies to the total', () => {});
});
```

<!-- sent: names -->

```json
[
  { "automationKey": "tests/prices.test.ts > prices > shows EUR as €" },
  { "automationKey": "tests/prices.test.ts > prices > shows USD as $" },
  { "automationKey": "tests/prices.test.ts > prices > discount > applies to the total" }
]
```

## Missing cases

A test whose key matches no case creates one, named after the test (ids removed), under `suiteUlid`
(the project root by default), in a suite named after its test file; with `keyIncludesFile: false`,
after its outermost `describe`, when it has one. With `createMissingCases: false`
(`PROBARA_CREATE_MISSING_CASES=false`) such a test records nothing and is logged as unmatched: only
existing cases get results. [`probara.title()` and `probara.suite()`](metadata.md#title-and-suite)
choose the name and the suite of a created case.

## The same keys as `probara import junit`

A project that sent Vitest's JUnit output with `probara import junit` can switch to the reporter and
keep every case: the reporter builds the same keys and reads the same title ids, on Vitest 3, 4 and 5
([migrating from the JUnit import](migrating-from-junit.md)).

| Vitest's JUnit output                                        | Reporter setting                 |
| ------------------------------------------------------------ | -------------------------------- |
| `--reporter=junit`, with or without `addFileAttribute: true` | Nothing: `keyIncludesFile` is on |
| Written with another `ancestorSeparator` (Vitest 5)          | Different keys: link by case ids |

Keep running `vitest` with the same root as before: the file of a key is relative to it. The
reporter sends more than the import: every attempt of a retried test, the steps, files, links and
parameters of the `probara.*` helpers, and `probara.id()` links. The import's side is in
[Vitest JUnit](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/junit.md#vitest).

## See also

- [Metadata](metadata.md): name the case a report creates.
- [Configuration](configuration.md): `keyIncludesFile`, `rootDir` and `projects`.
- [Retries and repeats](retries.md): every execution goes to the same case.
