# Linking tests to cases

Each result goes to a Probara test case. A test that names its case is linked to it; a test that
names none is matched by its automation key, and its case is created the first time it is
reported. Link tests when their cases already exist in Probara (written by hand, or imported).

## Three ways to name a case

| Way                         | Example                                                                               | When                                       |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| A `probara_case` annotation | `test('pays', { annotation: { type: 'probara_case', description: 'SHOP-12' } }, ...)` | The usual way; works for skipped tests too |
| A case id in the title      | `test('SHOP-12 pays with a card', ...)`                                               | Quick, visible in every report             |
| `probara.id()` in the test  | `probara.id('SHOP-12')`                                                               | Ids known only at run time                 |

<!-- project: linking -->

```ts
// tests/checkout.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test.describe('checkout', () => {
  test(
    'pays with a card',
    { annotation: { type: 'probara_case', description: 'SHOP-12' } },
    async () => {
      // ...
    },
  );

  test('SHOP-13 pays with a voucher', async () => {
    // ...
  });

  test('pays with a gift card', async () => {
    probara.id('SHOP-14');
  });

  test('shows the total', async () => {
    // No case named: matched by its key, created the first time.
  });
});
```

Probara receives one result per test, each with its case, and the same key it would get without
the ids:

<!-- sent: linking -->

```json
[
  {
    "caseDisplayId": "SHOP-12",
    "automationKey": "checkout.spec.ts > checkout > pays with a card",
    "title": "pays with a card"
  },
  {
    "caseDisplayId": "SHOP-13",
    "automationKey": "checkout.spec.ts > checkout > pays with a voucher",
    "title": "pays with a voucher"
  },
  {
    "caseDisplayId": "SHOP-14",
    "automationKey": "checkout.spec.ts > checkout > pays with a gift card"
  },
  { "automationKey": "checkout.spec.ts > checkout > shows the total" }
]
```

- **Annotations** take one id or a comma list (`'SHOP-12, SHOP-13'`), and several annotations
  add up. Since Playwright 1.42 they go in the test details; a test can also push one at run time
  (`test.info().annotations.push({ type: 'probara_case', description: 'SHOP-12' })`).
- **Title ids** are the ids of the reported project (and of [`projects`](multi-project.md)) in a
  describe or test title, as `SHOP-12` or `SHOP_12`, anywhere in the title. They are removed from
  the title and from the key, so adding one never changes a key. An id of a project the reporter
  does not know stays in the title, as text.
- **`probara.id()`** takes an id or a list, and adds a `probara_case` annotation to the running
  attempt. A test skipped before it runs (`test.skip('title', ...)`, or a skipped `describe`) never
  runs its body: link it with an annotation or a title id instead.

The ids are the case's display id: the project code, a dash and the number shown in Probara
(`SHOP-12`). An id Probara does not know is not recorded: the log names it as unmatched
([troubleshooting](troubleshooting.md#results-were-not-recorded-unmatched)).

## Several cases, and several sources

Every source counts: the annotations first (in order, `probara.id()` among them), then the title
ids, each id once. A test linked to several cases is sent once per case, with the same key, its
attachments uploaded to each result:

<!-- project: several -->

```ts
// tests/login.spec.ts
import { test } from '@playwright/test';

test(
  'SHOP-21 logs in',
  { annotation: { type: 'probara_case', description: 'SHOP-20, SHOP-21' } },
  async () => {
    // ...
  },
);
```

<!-- sent: several -->

```json
[
  { "caseDisplayId": "SHOP-20", "automationKey": "login.spec.ts > logs in" },
  { "caseDisplayId": "SHOP-21", "automationKey": "login.spec.ts > logs in" }
]
```

## Automation keys

A test that names no case is matched by its automation key: the same key finds the same case on
every run, and a new key creates a new case. The key is built from:

| Part               | From                                                                 | Example              |
| ------------------ | -------------------------------------------------------------------- | -------------------- |
| File               | The test file, relative to `rootDir` (Playwright's, by default)      | `checkout.spec.ts`   |
| Title path         | The `describe` titles, then the test title, case ids removed         | `checkout > pays`    |
| Playwright project | `[project=<name>]` for a named Playwright project, nothing otherwise | `[project=chromium]` |

So `checkout.spec.ts > checkout > pays [project=chromium]` is the key of a test in a `chromium`
project. Each Playwright project gets its own case: the same test in `chromium` and `firefox` is
two cases. The key algorithm is
[automation key v1](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#the-automation-key-v1)
of `@probara/core`, frozen and shared by every Probara tool.

What changes a key, and so creates a new case: renaming a test, a `describe` or a file, moving a
file, renaming a Playwright project, or changing `rootDir` (or `testDir`, which Playwright's
`rootDir` follows). What does not: adding or removing a case id, `probara.title()` and
`probara.suite()` (they only name the case a report creates), `probara.parameters()`, the
Playwright version, and the CI.

## Missing cases

A test whose key matches no case creates one, named after the test, in a suite path built from
the file and the `describe` titles, under `suiteUlid` (the project root by default). With
`createMissingCases: false` (`PROBARA_CREATE_MISSING_CASES=false`) such a test records nothing and
is logged as unmatched: only existing cases get results. [`probara.title()` and
`probara.suite()`](metadata.md) choose the name and the suite of a created case.

## The same keys as `probara import junit`

The reporter builds the keys the [`probara` CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md)
gives Playwright's JUnit reporter (`--reporter=junit`), and reads the same links:
`probara_case` annotations (which the JUnit reporter writes as properties) and case ids in titles.
A project that imported Playwright's JUnit XML with `probara import junit` can switch to the
reporter and keep every case:

1. Keep `rootDir` (or `testDir`) as it was: the JUnit reporter writes file paths relative to it.
2. Replace the JUnit import step with the reporter in `playwright.config`, and keep
   `PROBARA_API_TOKEN` and `PROBARA_PROJECT` in the test step's environment.
3. Check the keys before you switch: `probara import junit junit.xml --dry-run` prints the key of
   each test, and a [results file](debugging.md#check-what-would-be-sent) written by the reporter
   with reporting off prints its own the same way.

What the reporter sends on top of the JUnit import: every attempt as its own result, steps,
attachments of steps, metadata, and the files Playwright keeps (videos, traces).

## See also

- [Metadata](metadata.md): name the case a report creates.
- [Several projects](multi-project.md): ids of other Probara projects.
- [Upgrading](upgrade.md#the-automation-key-contract): the key contract.
