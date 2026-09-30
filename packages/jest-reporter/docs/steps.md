# Steps

The steps of a test show under its result in Probara, nested as they ran, each with its status,
duration and error. Jest has no steps of its own: write them with `probara.step()`, which runs its
body and records it.

## `probara.step()`

<!-- project: steps, exit: 1 -->

```js
// tests/checkout.test.js
const { probara } = require('@probara/jest-reporter');

test('checks out', async () => {
  const cart = await probara.step('Open the cart', async () => ({ items: 2 }));
  await probara.step('Pay', async () => {
    probara.step('Enter the card', () => {
      expect(cart.items).toBe(2);
    });
    await probara.step('Confirm', async () => {
      expect(await Promise.resolve('declined')).toBe('paid');
    });
  });
});
```

<!-- sent: steps -->

```json
[
  {
    "status": "failed",
    "steps": [
      { "action": "Open the cart", "status": "passed" },
      {
        "action": "Pay",
        "status": "failed",
        "steps": [
          { "action": "Enter the card", "status": "passed" },
          { "action": "Confirm", "status": "failed" }
        ]
      }
    ]
  }
]
```

`probara.step(title, body, options)` runs `body` and returns what it returns, so a step can
compute a value the test uses (`cart` above):

| The body                        | The step                                                          | What `probara.step()` does                     |
| ------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Returns                         | `passed`                                                          | Returns its value                              |
| Throws                          | `failed`, with the error's message and stack; its parents fail    | Throws the same error: the test fails as usual |
| Returns a promise (`async`)     | Ends when the promise settles: `passed`, or `failed`              | Returns a promise that settles the same way    |
| Returns another thenable        | Ends when the body returns (see [below](#promises-and-thenables)) | Returns it untouched                           |
| None (`probara.step('Seeded')`) | `passed`, with no duration                                        | Returns `undefined`                            |

- **Nesting** follows the calls: a step started inside another step's body is its child, across
  `await` too. Two steps of the same parent run with `Promise.all` are both its children.
- **Duration** is measured with Node's own clock, so Jest's fake timers (`jest.useFakeTimers()`)
  never change it.
- **A step that never ended** (a promise the test did not await, still pending when the test ends)
  is `failed`, with the error `The step had not finished when the test ended`. Await every
  `probara.step()` that has an `async` body.
- **Hooks**: a step in `beforeEach` or `afterEach` is a step of the running test. In `beforeAll`,
  `afterAll` or a `describe` body no single test runs: the body runs, and the step is not recorded
  ([where to call the helpers](metadata.md#where-to-call-the-helpers)).

## Steps of a new case

A result's steps record what ran. A **case's** steps are its specification: an action, the expected
result and the test data. The outermost steps of an attempt, in the order they started, are the
steps of the case the report creates; `expected` and `data` go with them:

<!-- project: case-steps -->

```js
// tests/refund.test.js
const { probara } = require('@probara/jest-reporter');

test('refunds an order', () => {
  probara.step('Open the order', () => {}, { expected: 'The order is shown', data: 'order=1042' });
  probara.step(
    'Refund it',
    () => {
      probara.step('Confirm the dialog', () => {});
    },
    { expected: 'The order is refunded' },
  );
});
```

<!-- sent: case-steps -->

```json
[
  {
    "steps": [
      { "action": "Open the order", "expected": "The order is shown", "data": "order=1042" },
      {
        "action": "Refund it",
        "expected": "The order is refunded",
        "steps": [{ "action": "Confirm the dialog" }]
      }
    ],
    "case": {
      "steps": [
        { "action": "Open the order", "expected": "The order is shown", "data": "order=1042" },
        { "action": "Refund it", "expected": "The order is refunded" }
      ]
    }
  }
]
```

- Nested steps (`Confirm the dialog`) are steps of the result only: how a test works, not what it
  specifies.
- Like every case field, case steps apply only when the report creates the case
  ([created cases only](metadata.md#created-cases-only)). An existing case keeps its own steps.
- `expected` and `data` are strings: a step given anything else is recorded with its title only,
  and one warning says so.

## Promises and thenables

A body that returns a promise ends its step when the promise settles. `probara.step()` returns a
new promise that settles the same way, so `await probara.step(...)` behaves as awaiting the body. A
rejection the test never handles is still an unhandled rejection, which fails the test, as it would
without the step.

A body can also return a **thenable** that is not a promise: a `supertest` request, a query
builder. Calling its `then()` would start it (or start it twice), so `probara.step()` returns it
untouched, and the step ends as soon as the body returns, before the request is sent. To time the
request inside the step, await it in an `async` body:

<!-- project: thenables -->

```js
// tests/api.test.js
const { probara } = require('@probara/jest-reporter');

// A stand-in for a supertest request: it runs when awaited.
const request = () => ({ then: (resolve) => resolve({ status: 200 }) });

test('answers the health check', async () => {
  const response = await probara.step('Call /health', async () => await request());
  expect(response.status).toBe(200);
});
```

<!-- sent: thenables -->

```json
[{ "status": "passed", "steps": [{ "action": "Call /health", "status": "passed" }] }]
```

## Files of a step

A file attached while a step runs (`probara.attach()`, from the step's body or anything it calls)
goes to that step, so Probara shows it where it happened
([attachments](attachments.md#files-of-a-step)).

## Troubleshooting

- **A step is missing.** Only `probara.step()` makes steps: `expect` calls and helper functions
  do not. A step called outside a test (`beforeAll`, a `describe` body) runs its body and records
  nothing, with a warning.
- **Steps are flattened, or fail with `The step had not finished`.** A step started without
  `await` ends after the test: await every `probara.step()` whose body is `async`.
- **The case has no steps.** Only a case the report creates takes steps. An existing case keeps its
  own.

## See also

- [Attachments](attachments.md): files of steps.
- [Metadata](metadata.md): the other fields of a new case.
- [Migrating from Qase](migrating-from-qase.md): `qase.step()` next to `probara.step()`.
