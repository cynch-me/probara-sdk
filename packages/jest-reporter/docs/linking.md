# Linking tests to cases

Each result goes to a Probara test case. A test that names its case is linked to it; a test that
names none is matched by its automation key, and its case is created the first time it is reported.
Link tests when their cases already exist in Probara (written by hand, or imported).

## Two ways to name a case

| Way                                     | Example                                           | When                                 |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| A case id in a test or `describe` title | `test('SHOP-12 pays with a card', ...)`           | The usual way; works for skipped too |
| `probara.id()` in the test              | `probara.id('SHOP-14')`, `probara.id(['A', 'B'])` | Ids known only while the test runs   |

<!-- project: linking -->

```js
// tests/checkout.test.js
const { probara } = require('@probara/jest-reporter');

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
    "automationKey": "tests/checkout.test.js > checkout pays with a card"
  },
  {
    "caseDisplayId": "SHOP-13",
    "automationKey": "tests/checkout.test.js > checkout vouchers pays with a voucher"
  },
  {
    "caseDisplayId": "SHOP-14",
    "automationKey": "tests/checkout.test.js > checkout pays with a gift card"
  },
  { "automationKey": "tests/checkout.test.js > checkout shows the total" }
]
```

- **Title ids** are the ids of the reported project (and of
  [`projects`](projects.md#several-probara-projects)) in a `describe` or test title, as `SHOP-12` or
  `SHOP_12`, anywhere in it. An id in a `describe` links every test inside it. They are removed from
  the key, so adding one never changes a key. An id of a project the reporter does not know stays
  in the title, as text.
- **`probara.id()`** takes an id or a list, and links the running attempt. A test skipped before it
  runs (`test.skip`, a skipped `describe`, `test.todo`) never runs its body: link it with a title id
  instead. [Run selection](run-selection.md) does not see `probara.id()` either: it decides before
  the test runs.

The ids are the case's display id: the project code, a dash and the number shown in Probara
(`SHOP-12`). An id Probara does not know is not recorded: the log names it as unmatched
([troubleshooting](troubleshooting.md#results-were-not-recorded-unmatched)).

## Several cases

Every source counts: `probara.id()` first (in call order), then the ids of the titles, each id
once. A test linked to several cases is sent once per case, with the same key, its files uploaded
to each result:

<!-- project: several -->

```js
// tests/login.test.js
const { probara } = require('@probara/jest-reporter');

test('SHOP-21 logs in', () => {
  probara.id('SHOP-20');
});
```

<!-- sent: several -->

```json
[
  { "caseDisplayId": "SHOP-20", "automationKey": "tests/login.test.js > logs in" },
  { "caseDisplayId": "SHOP-21", "automationKey": "tests/login.test.js > logs in" }
]
```

## Automation keys

A test that names no case is matched by its automation key: the same key finds the same case on
every run, and a new key creates a new case. The key is the one
[`probara import junit`](#the-same-keys-as-probara-import-junit) gives the test in jest-junit's
report:

| Part | From                                                                                            | Example                  |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------ |
| File | The test file, relative to `rootDir` (the real path of the directory `jest` runs in)            | `tests/checkout.test.js` |
| Name | The `describe` titles and the test title, joined by spaces, as jest-junit names it; ids removed | `checkout pays`          |

So `tests/checkout.test.js > checkout pays` is the key of `test('pays')` inside
`describe('checkout')`. With [`keyIncludesFile: false`](configuration.md#keyincludesfile) the file
is left out (`checkout pays`), like jest-junit's report without its file attribute. The key
algorithm is
[automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1)
of `@probara/core`, frozen and shared by every Probara tool.

What changes a key, and so creates a new case: renaming a test, a `describe` or a file, moving a
file, running `jest` from another directory (the file is relative to it; set `rootDir` to keep it),
or changing `keyIncludesFile`. What does not: adding or removing a case id, `probara.title()` and
`probara.suite()` (they only name the case a report creates), `probara.parameters()`, the Jest
version, a Jest [`projects`](projects.md#jest-projects) entry, and the CI.

### Names as jest-junit writes them

The name is jest-junit's, with its default templates, so a key never depends on which of the two
tools reported the test:

- **`test.each`** rows are tests of their own, named with their values: each row is a case. A
  table whose rows give the same name (no placeholder in the title) makes tests that share one key:
  they record into the same case.
- **`$` in a title** is read the way jest-junit's templates read it: `$$` becomes `$`, and `$&`
  becomes the placeholder it replaced. `costs $$5` has the key `... costs $5`.
- **`{displayName}` in a title** becomes the name of the Jest project that runs the test, as
  jest-junit fills it in ([Jest projects](projects.md#jest-projects)).
- **`›`** (with its spaces) in a title splits it into two segments of the key, as the JUnit import
  splits jest-junit's names.

<!-- project: names -->

```js
// tests/prices.test.js
describe('prices', () => {
  test.each([
    ['EUR', '€'],
    ['USD', '$'],
  ])('shows %s as %s', () => {});

  test('costs $$5 with a voucher', () => {});
});
```

<!-- sent: names -->

```json
[
  { "automationKey": "tests/prices.test.js > prices shows EUR as €" },
  { "automationKey": "tests/prices.test.js > prices shows USD as $" },
  { "automationKey": "tests/prices.test.js > prices costs $5 with a voucher" }
]
```

Two tests of one file with the same full name (the same `describe` titles and title, or `a b` ›
`c` and `a` › `b c`) share a key: Probara records both into one case, and what their `probara.*`
calls said is left out, with one warning, rather than given to the wrong test
([troubleshooting](troubleshooting.md#a-test-lost-its-steps-or-files)).

## Missing cases

A test whose key matches no case creates one, named after the test (ids removed), under `suiteUlid`
(the project root by default), in a suite named after its test file; with `keyIncludesFile: false`,
after its outermost `describe`, when it has one. With `createMissingCases: false`
(`PROBARA_CREATE_MISSING_CASES=false`) such a test records nothing and is logged as unmatched: only
existing cases get results. [`probara.title()` and `probara.suite()`](metadata.md#title-and-suite)
choose the name and the suite of a created case.

## The same keys as `probara import junit`

A project that sent jest-junit's report with `probara import junit` can switch to the reporter and
keep every case: the reporter builds the same keys and reads the same title ids.

| jest-junit's report                                   | Reporter setting                 |
| ----------------------------------------------------- | -------------------------------- |
| Written with `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`     | Nothing: `keyIncludesFile` is on |
| Written without the file attribute (its default)      | `keyIncludesFile: false`         |
| Written with other templates (`classNameTemplate`...) | Different keys: link by case ids |

Keep running `jest` from the same directory as before: the file of a key is relative to it. The
[JUnit migration guide](migrating-from-junit.md) has the steps, how to compare the keys before you
switch, and what the reporter records differently (a `test.todo`, retries).

## See also

- [Metadata](metadata.md): name the case a report creates.
- [Jest and Probara projects](projects.md): ids of other Probara projects, Jest `projects`.
- [Upgrading](upgrade.md#the-automation-key-contract): the key contract.
