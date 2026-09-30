# Metadata

`probara` tells the reporter more about a test, from the test body or a `beforeEach` or
`afterEach` hook. Require it (or import it) from the reporter's package:

<!-- project: quick -->

```js
// tests/payments.test.js
const { probara } = require('@probara/jest-reporter');

test('pays with a card', () => {
  probara.title('Pays with a saved card').suite(['Payments', 'Cards']).tags('smoke');
});
```

In a test file compiled from ES modules (Babel, `ts-jest`), `import { probara } from
'@probara/jest-reporter'` gives the same helpers.

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
| `attach({ name, path \| body, ... })` | Attaches a file ([attachments](attachments.md#probaraattach))                      | Each one attaches  |
| `step(title, body?, options?)`        | A step of the result, and of the new case ([steps](steps.md))                      | Each one is a step |

The helpers that return nothing else return `probara`, so calls chain. Each applies to the running
attempt only: a retry starts empty.

## Created cases only

`title`, `suite`, `tags`, `fields` and the case steps describe the case a report **creates**, the
first time a test is reported. An existing case never changes: Probara keeps what people wrote
there. The automation key never changes either ([keys](linking.md#automation-keys)), so a new title
still matches the same case.

<!-- project: created -->

```js
// tests/payments.test.js
const { probara } = require('@probara/jest-reporter');

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
    "automationKey": "tests/payments.test.js > pays",
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
Its suite is the test file (`tests/payments.test.js`), or, with `keyIncludesFile: false`, the
outermost `describe`, unless `suite()` gives one: `suite('Payments')` or
`suite(['Payments', 'Cards'])` for nested suites, created as needed under `suiteUlid`.

## Comment

`comment()` writes a line first in the notes of the result, before the error and its stack:

<!-- project: comment -->

```js
// tests/search.test.js
const { probara } = require('@probara/jest-reporter');

test('searches the catalog', () => {
  probara.comment('Ran against the staging catalog');
});
```

<!-- sent: comment -->

```json
[
  {
    "automationKey": "tests/search.test.js > searches the catalog",
    "notes": "Ran against the staging catalog"
  }
]
```

When the attempt fails, its error follows the comment in the same notes, without the terminal's
colors: the comment never hides the error.

## Parameters

`parameters()` records the values an attempt ran with, shown with its result, such as the user or
the data set of a data-driven test. They are never part of the key: the test is one case whatever
its parameters.

<!-- project: parameters -->

```js
// tests/users.test.js
const { probara } = require('@probara/jest-reporter');

test.each(['admin', 'viewer'])('opens the dashboard as %s', (role) => {
  probara.parameters({ role, seats: 5 });
});
```

<!-- sent: parameters -->

```json
[
  {
    "automationKey": "tests/users.test.js > opens the dashboard as admin",
    "parameters": { "role": "admin", "seats": "5" }
  },
  {
    "automationKey": "tests/users.test.js > opens the dashboard as viewer",
    "parameters": { "role": "viewer", "seats": "5" }
  }
]
```

A `test.each` title that holds the value (as above) is one case per value, which is how Jest names
its rows. Keep a placeholder in the title: rows with the same name in one file share one key, and
what their helpers said is left out ([names](linking.md#names-as-jest-junit-writes-them)).

## Ignore an attempt

`ignore()` leaves the running attempt out: it still runs, and Jest reports it, but Probara does not
get it. The count of the log says how many were left out.

<!-- project: ignored -->

```js
// tests/experimental.test.js
const { probara } = require('@probara/jest-reporter');

test('tries the new checkout', () => {
  probara.ignore();
});

test('pays', () => {});
```

<!-- output: ignored -->

```text
$ npx jest
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked); 1 ignored with probara.ignore()
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Where to call the helpers

| Where                                                        | What happens                                             |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| The test body, `beforeEach`, `afterEach`                     | Applies to the running attempt                           |
| A helper function or module the test calls                   | The same: the helpers find the running test on their own |
| The module scope, a `describe` body, `beforeAll`, `afterAll` | Ignored, with one warning: no single test runs there     |
| A `test.concurrent` test                                     | Applies to that test                                     |

A helper never throws into the test. A wrong argument, or a call while no test runs, is one
`[probara]` warning in the reporter's log, naming the test file, and the call is ignored:

<!-- project: outside -->

```js
// tests/orders.test.js
const { probara } = require('@probara/jest-reporter');

beforeAll(() => {
  probara.tags('orders');
});

test('lists the orders', () => {
  probara.tags('orders');
});
```

<!-- output: outside -->

```text
$ npx jest
[probara] probara.tags() only works while a test runs (in a test, or a beforeEach or afterEach hook) (first seen in tests/orders.test.js; repeats are logged at debug)
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Every worker, every environment

The helpers work wherever Jest runs a test: in its worker processes and in band (`--runInBand`), in
the `node` and `jsdom` test environments, in watch mode, and in test files written with `import`.
Nothing needs to be set up for them: the reporter tells the test processes where to write before
they start.

<!-- project: jsdom -->

```js
testEnvironment: 'jsdom',
```

<!-- project: jsdom -->

```js
// tests/banner.test.js
const { probara } = require('@probara/jest-reporter');

test('shows the banner', () => {
  document.body.innerHTML = '<p role="banner">Free shipping</p>';
  probara.parameters({ locale: document.documentElement.lang || 'en' });
});
```

<!-- sent: jsdom -->

```json
[{ "automationKey": "tests/banner.test.js > shows the banner", "parameters": { "locale": "en" } }]
```

### How metadata travels

Jest runs tests in worker processes and the reporter in its main one. When the run starts, the
reporter creates a folder in the system's temporary directory and names it to the test processes;
each `probara.*` call appends a line there, keyed by the test file, the test's full name and its
attempt, which the helpers read from Jest's own state (jest-circus). `probara.attach()` copies its
file there at once. The reporter reads the lines when each file ends, and removes the folder when
`jest` ends. Without the reporter, every helper does nothing (and `probara.step()` still runs its
body), so tests keep passing where the reporter is not registered.

Known limits:

- **jest-circus only.** The helpers find the running test in jest-circus's state, Jest's default
  runner. With `testRunner: 'jest-jasmine2'`, no call is recorded, and one warning says so.
- **`jest.mock('fs')`** replaces the file system of the test file, which the helpers write with:
  their calls in that file are lost, silently. Mock only the modules your code imports, or use
  `jest.spyOn` on the functions it calls.
- **Two tests with the same full name** in one file: what their calls said is left out, with a
  warning ([names](linking.md#names-as-jest-junit-writes-them)).
- **Jest 30.0 to 30.4 and `test.concurrent` retries**: those versions do not say which attempt of
  a concurrent test runs, so the calls of a retry of a `test.concurrent` test go to its first
  attempt. Jest 29 never retries concurrent tests, and 30.5 says.

## See also

- [Steps](steps.md): steps with `probara.step()`.
- [Attachments](attachments.md): `probara.attach()` and the console.
- [Links](links.md): `probara.link()` and `probara.issue()`.
- [Migrating from Qase](migrating-from-qase.md): `qase.*` next to `probara.*`.
