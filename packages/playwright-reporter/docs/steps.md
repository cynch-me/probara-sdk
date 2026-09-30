# Steps

The steps of a test show under its result in Probara, nested as they ran, each with its status,
duration and error. Write them with Playwright's own `test.step`: nothing else is needed.

## `test.step`

<!-- project: steps, exit: 1 -->

```ts
// tests/checkout.spec.ts
import { expect, test } from '@playwright/test';

test('checks out', async ({ page }) => {
  await test.step('Open the cart', async () => {
    await page.goto('https://shop.example.com/cart');
  });
  await test.step('Pay', async () => {
    await test.step('Enter the card', async () => {
      await page.getByLabel('Card number').fill('4242 4242 4242 4242');
    });
    await test.step('Confirm', async () => {
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

| What ran                                                                     | In the result                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| A `test.step`                                                                | A step, with its children                                |
| A hook (`beforeEach`, `afterEach`, `Before Hooks`...) that ran a `test.step` | A step named after the hook, holding those steps         |
| A hook or a fixture without a `test.step`                                    | Nothing: its `test.step` children, if any, move up       |
| `expect` calls, Playwright API calls (`page.click`...), fixtures             | Nothing: they are Playwright's internals, not your steps |

A step's status is `failed` when it threw (its parents fail with it), `skipped` for
`test.step.skip()`, and `passed` otherwise. Its error (message and stack) goes with it, and its
duration is Playwright's.

## Hooks

A hook that runs steps shows as a step of its own, so setup and teardown stay apart from the test:

<!-- project: hooks -->

```ts
// tests/orders.spec.ts
import { test } from '@playwright/test';

test.beforeEach(async () => {
  await test.step('Sign in', async () => {});
});

test('lists the orders', async () => {
  await test.step('Open the orders', async () => {});
});
```

<!-- sent: hooks -->

```json
[
  {
    "steps": [
      {
        "action": "Before Hooks",
        "steps": [{ "action": "beforeEach hook", "steps": [{ "action": "Sign in" }] }]
      },
      { "action": "Open the orders" }
    ]
  }
]
```

## Steps of a new case: `probara.step()`

A result's steps record what ran. A **case's** steps are its specification: an action, the expected
result and the test data. Declare them with `probara.step(action, expected, data)` as the title of
a `test.step`; the step runs as usual, and the case the report creates takes it:

<!-- project: case-steps -->

```ts
// tests/refund.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('refunds an order', async () => {
  await test.step(
    probara.step('Open the order', 'The order is shown', 'order=1042'),
    async () => {},
  );
  await test.step(probara.step('Refund it', 'The order is refunded'), async () => {
    await test.step('Confirm the dialog', async () => {});
  });
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

- `probara.step('Pay')` returns `Pay [probara:1]`: Playwright's reports show that title, and the
  reporter reads the short reference and sends `Pay`.
- The case steps are the `probara.step()` steps that ran and are not inside another one, in the
  order they started. A plain `test.step` is a step of the result only: nested helpers (`Confirm
the dialog`) are how a test works, not what it specifies.
- Like every case field, they apply only when the report creates the case
  ([created cases only](metadata.md#created-cases-only)).

## Files of a step

A file attached while a `test.step` runs (`testInfo.attach()`, `probara.attach()`) goes to that
step, so Probara shows it where it happened ([attachments](attachments.md#files-of-a-step)).

## Playwright versions

| Playwright     | What changes                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1.50 and later | Files go to the step they were attached in; `test.step.skip()` is a `skipped` step                                        |
| 1.42 to 1.49   | Playwright does not say which step a file belongs to: every file stays with the result; `test.step.skip()` does not exist |

## Troubleshooting

- **A step is missing.** Only `test.step` makes steps. A helper function that is not wrapped in
  `test.step` shows nothing; neither do `expect` calls.
- **Steps are flattened.** A step started without `await` ends before its children: await every
  `test.step`.
- **The case has no steps.** Only `probara.step()` titles declare case steps, and only for a case
  the report creates. An existing case keeps its own.

## See also

- [Attachments](attachments.md): files of steps.
- [Metadata](metadata.md): the other fields of a new case.
