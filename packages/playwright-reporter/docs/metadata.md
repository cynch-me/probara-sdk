# Metadata

`probara` tells the reporter more about a test, from the test body, a hook or a fixture. Import it
from the reporter's package:

```ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('pays with a card', async () => {
  probara.title('Pays with a saved card').suite(['Payments', 'Cards']).tags('smoke');
});
```

| Helper                                | What it does                                                                       | Repeated calls           |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------ |
| `id(id \| ids)`                       | Links existing cases ([linking](linking.md))                                       | Add up                   |
| `title(text)`                         | Title of the case the report creates                                               | The last one wins        |
| `suite(title \| titles)`              | Suite path of the case the report creates                                          | The last one wins        |
| `comment(text)`                       | A comment, first in the notes of the result, before the error                      | The last one wins        |
| `ignore()`                            | Leaves this attempt out: it is not reported                                        | —                        |
| `tags(...names)`                      | Tags of the case the report creates                                                | Add up, each once        |
| `fields(record)`                      | Fields of the case the report creates: system fields, custom fields, `description` | Merged by name           |
| `parameters(record)`                  | Parameters of the result, shown with it                                            | Merged by name           |
| `attach({ name, path \| body, ... })` | Attaches a file ([attachments](attachments.md#probaraattach))                      | Each one attaches        |
| `step(action, expected?, data?)`      | A `test.step` title that declares a step of the new case ([steps](steps.md))       | Each one declares a step |

Every synchronous helper returns `probara`, so calls chain. Each applies to the running attempt
only: a retry starts empty.

## Created cases only

`title`, `suite`, `tags`, `fields` and the declared steps describe the case a report **creates**,
the first time a test is reported. An existing case never changes: Probara keeps what people wrote
there. The automation key never changes either (see [keys](linking.md#automation-keys)), so a
renamed title still matches the same case.

<!-- project: created -->

```ts
// tests/payments.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('pays', async () => {
  probara
    .title('Pays with a saved card')
    .suite(['Payments', 'Cards'])
    .tags('smoke', 'payments')
    .fields({
      description: 'A returning customer pays with the card saved in their profile.',
      severity: 'critical',
      priority: 'high',
      'Risk area': 'Checkout',
    });
});
```

<!-- sent: created -->

```json
[
  {
    "automationKey": "payments.spec.ts > pays",
    "title": "Pays with a saved card",
    "suitePath": ["Payments", "Cards"],
    "case": {
      "description": "A returning customer pays with the card saved in their profile.",
      "tags": ["smoke", "payments"],
      "fields": { "severity": "critical", "priority": "high", "Risk area": "Checkout" }
    }
  }
]
```

### Fields

`fields()` takes names and values (numbers and booleans become strings):

| Name                                                                      | What it sets                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `description`                                                             | The case description                                 |
| `severity`, `priority`, `type`, `layer`, `behavior`, `status`, `is_flaky` | The system fields, by the name of an option (`high`) |
| `preconditions`, `postconditions`                                         | The system text fields                               |
| Any other name, such as `'Risk area'`                                     | The custom field of that name                        |

Probara resolves names and options when it creates the case. A field or an option it does not know
is skipped and logged as a warning; the result is recorded all the same. A field with an empty
value is skipped silently.

### Title and suite

The title of a created case is the test title (case ids removed) unless `title()` says otherwise.
Its suite path is the file and the `describe` titles (`payments.spec.ts > Cards`) unless `suite()`
gives one: `suite('Payments')` or `suite(['Payments', 'Cards'])` for nested suites, created as
needed under `suiteUlid`.

## Comment

`comment()` writes a line first in the notes of the result, before the error and its stack:

<!-- project: comment -->

```ts
// tests/search.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('searches the catalog', async () => {
  probara.comment('Ran against the staging catalog');
});
```

<!-- sent: comment -->

```json
[
  {
    "automationKey": "search.spec.ts > searches the catalog",
    "notes": "Ran against the staging catalog"
  }
]
```

## Parameters

`parameters()` records the values an attempt ran with, shown with its result, such as the user or
the data set of a data-driven test. They are never part of the key: the test is one case whatever
its parameters. The Playwright project is part of the key instead (`[project=chromium]`).

<!-- project: parameters -->

```ts
// tests/users.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

for (const role of ['admin', 'viewer']) {
  test(`opens the dashboard as ${role}`, async () => {
    probara.parameters({ role, seats: 5 });
  });
}
```

<!-- sent: parameters -->

```json
[
  {
    "automationKey": "users.spec.ts > opens the dashboard as admin",
    "parameters": { "role": "admin", "seats": "5" }
  },
  {
    "automationKey": "users.spec.ts > opens the dashboard as viewer",
    "parameters": { "role": "viewer", "seats": "5" }
  }
]
```

A test whose title holds the parameter (as above) is one case per value. Keep the title fixed and
pass the value with `parameters()` for one case with every value in its history.

## Ignore an attempt

`ignore()` leaves the running attempt out: it still runs, and Playwright reports it, but Probara
does not get it. The count of the log says how many were left out.

<!-- project: ignored -->

```ts
// tests/experimental.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('tries the new checkout', async () => {
  probara.ignore();
});

test('pays', async () => {});
```

<!-- output: ignored -->

```text
$ npx playwright test
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked); 1 ignored with probara.ignore()
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Where to call the helpers

- In the test body, `beforeEach`, `afterEach`, or a test fixture: they apply to the running
  attempt. Not in `beforeAll`, `afterAll` or a worker fixture, where no single test runs.
- A helper never throws into the test. A wrong argument, or a call while no test runs, is a
  `[probara]` warning on the test's stderr, and the call is ignored.

<!-- project: fixture -->

```ts
// tests/fixtures.ts
import { test as base } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

export const test = base.extend<{ account: string }>({
  account: async ({}, use) => {
    probara.parameters({ account: 'demo' });
    await use('demo');
  },
});
```

<!-- project: fixture -->

```ts
// tests/account.spec.ts
import { test } from './fixtures';

test('shows the account', async ({ account }) => {
  test.info().annotations.push({ type: 'note', description: account });
});
```

<!-- sent: fixture -->

```json
[{ "automationKey": "account.spec.ts > shows the account", "parameters": { "account": "demo" } }]
```

## How metadata travels

Playwright runs tests in worker processes and the reporter in the main one. The helpers send their
metadata as small attachments named `_probara` (`application/vnd.probara.metadata+json`), which
belong to one attempt, survive blob reports and `merge-reports`, and are never uploaded. Playwright's
HTML report lists them with the attempt; on Playwright 1.42 each call also shows as an `attach`
step there. Case ids travel as `probara_case` annotations, which Playwright's JUnit reporter writes
too.

## See also

- [Steps](steps.md): declared case steps with `probara.step()`.
- [Attachments](attachments.md): `probara.attach()`.
- [Migrating from Qase](migrating-from-qase.md): `qase.*` next to `probara.*`.
