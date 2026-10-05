# Metadata

Everything a Cypress spec can say about the test it runs, with the `probara.*` helpers of the
support file. The helpers are the same set `@probara/jest-reporter` has, and they mean the same thing
here; the docs of that reporter describe each one in full, and this page is about what is different
in a Cypress run.

```js
// cypress/support/e2e.js
require('@probara/cypress-reporter/support'); // or: import '@probara/cypress-reporter/support'
```

The support file publishes `probara` on the global of the spec frame, so a spec calls the helpers
with no import of its own:

```js
// cypress/e2e/cart.cy.js
describe('Cart', () => {
  it('SHOP-12 adds an item', () => {
    probara.id('SHOP-12').title('Adds an item').comment('from the cart').tags('smoke', 'cart');
    probara.parameters({ build: 42 });
    cy.get('.add').click();
  });
});
```

| Helper                                   | What it says about the test                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `probara.id(ids)`                        | The cases it is linked to (`'SHOP-12'`, or a list of them). Never part of the automation key. |
| `probara.title(title)`                   | The title of the case the report creates.                                                     |
| `probara.suite(path)`                    | The suite path of the case the report creates.                                                |
| `probara.comment(text)`                  | A comment, written first in the notes of the result, before the error.                        |
| `probara.ignore()`                       | Leaves this attempt out of the report.                                                        |
| `probara.parameters(values)`             | Parameters shown with the result, merged by name.                                             |
| `probara.tags(...tags)`                  | Tags of the case the report creates, accumulated.                                             |
| `probara.fields(values)`                 | Fields of the case the report creates (`severity`, `priority`, ...).                          |
| `probara.link(url, name?)`               | A link shown with the result.                                                                 |
| `probara.issue(id)`                      | An issue of the result, linked with [`issueUrlTemplate`](configuration.md).                   |
| `probara.attach({ name, path \| body })` | A file or a body attached to the attempt. See [attachments](attachments.md).                  |
| `probara.step(title, body?, options?)`   | A step of the attempt. See [steps](steps.md).                                                 |

The metadata helpers return the helpers, so calls chain. `probara.attach()` returns the chain of
`cy.readFile()` when it read a file (see [attachments](attachments.md)); `probara.step()` returns
nothing.

## What is different in a Cypress run

**Where the message goes.** The browser has no way to reach the reporter: every call goes to the
plugin of the run with `cy.task('probara', …)`, and the plugin writes it where the reporter of the
spec reads it. A call is therefore awaited by Cypress like any other command, and it reaches the
report before the test ends.

**Which test a call belongs to.** The browser names the test that is running (`Cypress.currentTest`)
and never the attempt: the reporter resolves the attempt from its own Mocha events. A call in a
`beforeEach` or an `afterEach` belongs to the test it runs for. Cypress names the first test of a
describe as the running one in its `before` hook, and the last one in its `after` hook: a call there
belongs to that test. A call made before any test of a spec has run belongs to no test at all: it is
dropped, with one warning in the run's log naming it, and is never given to another test.

**What a step of a test does.** `probara.step()` runs its body, which queues Cypress commands, and
the step ends once those commands ran. It is not a promise: a body that throws fails its test
before Cypress runs the commands that body queued, so the step is reported as the test ended (see
[steps](steps.md)).

**A wrong argument, and a run with no plugin.** A wrong argument is one warning in the run's log and
nothing else: the test is never failed by a helper. Without the plugin (`setupNodeEvents`) there is
nobody to carry what a helper said: every helper does nothing and one line on the browser console
says why.

**`probara.id()` and `runCasesOnly`.** The cases a test is linked to with `probara.id()` are not the
ones the run selection matches: that decision happens before the test runs. See
[configuration](configuration.md).
