# Metadata

`probara` tells the reporter more about a test, from the test body, its `beforeEach` and
`afterEach` hooks, or `onTestFinished`. Import it from the reporter's package:

<!-- project: quick -->

```ts
// tests/payments.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('pays with a card', () => {
  probara.title('Pays with a saved card').suite(['Payments', 'Cards']).tags('smoke');
});
```

Nothing needs setting up: the reporter adds what the helpers need to every Vitest project, in the
threads and forks pools and in browser mode.

| Helper                                | What it does                                                                       | Repeated calls     |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------ |
| `id(id \| ids)`                       | Links existing cases ([linking](linking.md))                                       | Add up             |
| `title(text)`                         | Title of the case the report creates                                               | The last one wins  |
| `suite(title \| titles)`              | Suite path of the case the report creates                                          | The last one wins  |
| `comment(text)`                       | A comment, first in the notes of the result, before the error                      | The last one wins  |
| `ignore()`                            | Leaves this attempt out: it is not reported                                        | —                  |
| `tags(...names)`                      | Tags of the case the report creates                                                | Add up, each once  |
| `fields(record)`                      | Fields of the case the report creates: system fields, custom fields, `description` | Merged by name     |
| `parameters(record)`                  | Parameters of the result, shown with it                                            | Merged by name     |
| `link(url, name?)`, `issue(id)`       | Links of the result ([links](links.md))                                            | Add up             |
| `attach({ name, path \| body, ... })` | Attaches a file ([attachments](attachments.md#probaraattach)); await it            | Each one attaches  |
| `step(title, body?, options?)`        | A step of the result, and of the new case ([steps](steps.md))                      | Each one is a step |

The helpers that return nothing else return `probara`, so calls chain. Each applies to the running
attempt only: a retry starts empty. The names, arguments and rules are the Jest reporter's;
[differences from the Jest API](#differences-from-the-jest-api) lists what Vitest changes.

## Created cases only

`title`, `suite`, `tags`, `fields` and the case steps describe the case a report **creates**, the
first time a test is reported. An existing case never changes: Probara keeps what people wrote
there. The automation key never changes either ([keys](linking.md#automation-keys)), so a new title
still matches the same case.

<!-- project: created -->

```ts
// tests/payments.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('pays', () => {
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
    "automationKey": "tests/payments.test.ts > pays",
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
Its suite is the test file (`tests/payments.test.ts`), or, with `keyIncludesFile: false`, the
outermost `describe`, unless `suite()` gives one: `suite('Payments')` or
`suite(['Payments', 'Cards'])` for nested suites, created as needed under `suiteUlid`.

### Vitest tags

The tags of a test (Vitest 4.1 and later) join the tags of the case the report creates, after
those of `probara.tags()`, each once. Vitest refuses a tag its config does not declare, so declare
each one in `test.tags`:

<!-- project: native-tags -->

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    tags: [{ name: 'smoke' }],
    reporters: ['default', '@probara/vitest-reporter'],
  },
});
```

<!-- project: native-tags -->

```ts
// tests/search.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('finds a product', { tags: ['smoke'] }, () => {
  probara.tags('search');
});
```

<!-- sent: native-tags -->

```json
[
  {
    "automationKey": "tests/search.test.ts > finds a product",
    "case": { "tags": ["search", "smoke"] }
  }
]
```

Like the tags of `probara.tags()`, they go to a created case only: never to a result, never into
the automation key, so adding a tag to a test never moves it to another case.

## Comment

`comment()` writes a line first in the notes of the result, before the error and its stack:

<!-- project: comment -->

```ts
// tests/search.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('searches the catalog', () => {
  probara.comment('Ran against the staging catalog');
});
```

<!-- sent: comment -->

```json
[
  {
    "automationKey": "tests/search.test.ts > searches the catalog",
    "notes": "Ran against the staging catalog"
  }
]
```

When the attempt fails, its errors follow the comment in the same notes, without the terminal's
colors: the comment never hides an error. Vitest's own `context.annotate()` messages are not sent
as notes: `comment()` is the way to write one.

## Parameters

`parameters()` records the values an attempt ran with, shown with its result, such as the user or
the data set of a data-driven test. They are never part of the key: the test is one case whatever
its parameters.

<!-- project: parameters -->

```ts
// tests/users.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test.each(['admin', 'viewer'])('opens the dashboard as %s', (role) => {
  probara.parameters({ role, seats: 5 });
});
```

<!-- sent: parameters -->

```json
[
  {
    "automationKey": "tests/users.test.ts > opens the dashboard as admin",
    "parameters": { "role": "admin", "seats": "5" }
  },
  {
    "automationKey": "tests/users.test.ts > opens the dashboard as viewer",
    "parameters": { "role": "viewer", "seats": "5" }
  }
]
```

- **`test.each` and `test.for`** rows are tests of their own, keyed by the title Vitest formats for
  them: keep a placeholder in the title (`%s`, `$role`), so each row is a case. Vitest does not keep
  a row's values anywhere else, so `parameters()` is the way to send them.
- **`describe.each`**: call the helpers in each test or its `beforeEach`; a call in the `describe`
  body runs while no test does.
- **Two tests with the same full name** share one key, so one case: each result still keeps what
  its own helpers said.
- **The reporter's own parameters**: `attempt` and `repeat` tell the executions of a retried or
  repeated test apart ([retries](retries.md)), and `project` names the Vitest project of a result
  when the config has more than one. A `project` of your own wins over Vitest's; `attempt` and
  `repeat` win over yours.

## Ignore an attempt

`ignore()` leaves the running attempt out: it still runs, and Vitest reports it, but Probara does
not get it. The count of the log says how many were left out.

<!-- project: ignored -->

```ts
// tests/experimental.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('tries the new checkout', () => {
  probara.ignore();
});

test('pays', () => {});
```

<!-- output: ignored -->

```text
$ npx vitest run
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked); 1 ignored with probara.ignore()
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Where to call the helpers

| Where                                                        | What happens                                             |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| The test body, `beforeEach`, `afterEach`, `onTestFinished`   | Applies to the running attempt                           |
| A helper function or module the test calls                   | The same: the helpers find the running test on their own |
| A `test.concurrent` test                                     | Applies to that test                                     |
| The module scope, a `describe` body, `beforeAll`, `afterAll` | Ignored, with one warning: no single test runs there     |

A helper never throws into the test. A call while no test runs is one warning per helper and test
file, which the test file prints in Vitest's output; a wrong argument (a blank tag here) is one
warning of the reporter's log for the run. Either way what is wrong is ignored and the test runs
on:

<!-- project: outside -->

```ts
// tests/orders.test.ts
import { probara } from '@probara/vitest-reporter';
import { beforeAll, test } from 'vitest';

beforeAll(() => {
  probara.tags('orders');
});

test('lists the orders', () => {
  probara.tags('orders', '');
});
```

<!-- output: outside -->

```text
$ npx vitest run
[probara] probara.tags() only works while a test runs (in a test, or a beforeEach or afterEach hook)
[probara] probara.tags() ignores blank tags (first seen in the run; repeats are logged at debug)
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Differences from the Jest API

`probara.*` has the Jest reporter's names, arguments, merge rules and messages. Vitest changes the
following:

| In the Vitest reporter                                                                                                                                                                                                                            | Why                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing goes in the config besides the reporter: no `setupFilesAfterEnv`, not even for `captureOutput` or `runCasesOnly`                                                                                                                          | Vitest lets a reporter add its setup file and runner to each project before the run                                                           |
| Await `probara.attach()`. In Node the file is copied at the call, as in Jest; in browser mode the copy ends later, and one that ends after its test ended is not attached, with a warning that says `Await probara.attach() before the test ends` | In a browser, Vitest's Node side reads the file, after the call returns                                                                       |
| A `test.concurrent` call goes to its own test through the reporter's runner. Where that runner cannot run (browser mode, a custom runner Node cannot import, such as a `.jsx` file), it is dropped with one warning                               | Vitest's own current test is one per worker, so it can name the wrong concurrent test: a call is dropped rather than recorded in another test |
| A call outside a test warns once per helper and test file, in the test file's output (`stderr \| tests/orders.test.ts`), not in the reporter's log                                                                                                | The call runs in a Vitest worker, which cannot write to the reporter's log in the main process                                                |
| A wrong argument in a test warns once per run, `(first seen in the run; ...)`                                                                                                                                                                     | The warning travels with the test's result, and the reporter logs each one once                                                               |
| Vitest tags (4.1 and later) join the tags of a created case                                                                                                                                                                                       | Jest has no test tags                                                                                                                         |
| A `test.each` or `test.for` row is keyed by Vitest's formatted title, which Vitest 4 and 5 write differently for object values                                                                                                                    | The key is the name Vitest's JUnit output gives the test, and that name comes from Vitest's own formatting                                    |
| Two tests with the same full name each keep their own helper calls (the Jest reporter leaves them out, with a warning)                                                                                                                            | Vitest keeps the calls in each test's own metadata, so nothing has to tell two names apart                                                    |
| A shard run with `--reporter=blob` on the command line records no helper call: list the reporter beside `blob` in the shards' config                                                                                                              | `--reporter` replaces the config's reporters, so the reporter never starts and adds no setup file                                             |
| With reporting off, the helpers still record, and nothing is sent                                                                                                                                                                                 | The reporter adds its setup file whatever the reporting setup, so the tests run the same with and without a token                             |
| In browser mode the helpers work in the browser, and `probara.attach({ path })` copies only a file Vite serves                                                                                                                                    | A browser cannot read a file: Vitest's Node side reads it, under Vite's `server.fs` rules                                                     |

## How metadata travels

Vitest runs the tests in workers and the reporter in its main process. Each `probara.*` call is
written into the running attempt's entry of the test's own metadata (`task.meta.probara`), which
Vitest sends to the reporter with the test's result; the reporter reads it when the run ends.
`probara.attach()` copies its file at once into a folder under Vitest's `attachmentsDir`. Vitest's
blob keeps each test's metadata, so a shard's blob carries the calls to `vitest --merge-reports`.
Without the reporter in the run's reporters, every helper does nothing (and `probara.step()` still
runs its body), so tests keep passing where the reporter is not registered.

Known limits:

- **`task.meta.probara` is the reporter's.** Test code can see it (`context.task.meta.probara`),
  but its shape is not an API, and writing to it changes what is sent: keep your own metadata under
  another key.
- **A custom `runner` Node cannot import** (`.jsx`, `.tsx`, or `.ts` on a Node without type
  stripping) is kept as it is, with one warning that names it: its attempts are still recorded, but
  the calls of its `test.concurrent` tests are dropped, with a warning.

## See also

- [Steps](steps.md): steps with `probara.step()`.
- [Attachments](attachments.md): `probara.attach()` and Vitest's annotations.
- [Links](links.md): `probara.link()` and `probara.issue()`.
- [Linking](linking.md): `probara.id()` and case ids in titles.
- [Retries and repeats](retries.md): what each attempt sends.
- [Statuses](statuses.md): where a comment and the errors go.
