# Steps

The steps of a test show under its result in Probara, nested as they ran, each with its status,
duration and error. Cypress has no steps of its own: write them with `probara.step()`, which runs
its body and records it.

## `probara.step()`

```js
// cypress/e2e/cart.cy.js
describe('Cart', () => {
  it('checks out', () => {
    probara.step(
      'Open the cart',
      () => {
        cy.get('.cart').click();
        probara.step('The cart holds two items', () => {
          cy.get('.cart-item').should('have.length', 2);
        });
      },
      { expected: 'The cart shows two items' },
    );

    probara.step('Pay by card', () => {
      cy.get('.pay').click();
    });
  });
});
```

The outermost steps are the steps of the case the report creates, with what `expected` and `data`
declare; the ones nested in them belong to their step only.

| Argument           | What it is                                                        |
| ------------------ | ----------------------------------------------------------------- |
| `title`            | What the step did. It is the `action` of the step in Probara.     |
| `body()`           | The Cypress commands of the step. Without it, a step that passed. |
| `options.expected` | The expected result, for the case the report creates.             |
| `options.data`     | The data the step uses, for the case the report creates.          |

## What a Cypress step is, and is not

**It returns nothing.** `probara.step()` is not a promise: its body queues Cypress commands, and the
step ends once Cypress has run them. A step is not a value a test can wait for, and it never yields
the result of its body.

**Its body runs synchronously.** Nesting is by call order: a `probara.step()` called inside the body
of another is its child, and a file attached inside a body belongs to that step. A body that awaits
between its commands interleaves them with the steps after it, so write the steps of a body without
awaiting between them, or split it into two steps.

**A command that fails ends nothing.** The step ends from a command Cypress runs after the body, so
a failing command never runs it: the reporter fails the step with _the step had not finished when
the test ended_, and the result carries the error of the command.

**A body that throws fails the test.** Cypress fails a test whose body throws before it runs the
commands that body queued, so the lines of that step are among them: the test is reported failed with
the error of the body, and the step itself is not. A step that fails through a Cypress command (an
expection inside it, or `cy.get()` on something that is not there) is reported as a failed step.

## Commands are not steps

Every Cypress command is not turned into a step: an action is what a test says it did with
`probara.step()`, not what its framework queued. Qase's `qase.step()` and Allure's
`allure.step()` behave the same way.
