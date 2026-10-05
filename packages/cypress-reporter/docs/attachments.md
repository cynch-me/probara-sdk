# Attachments

A test can attach a file or a body to its result with `probara.attach()`. Cypress takes a screenshot
of a failure by itself ([`attachScreenshots`](configuration.md)) and can record the video of a spec
([`attachVideos`](configuration.md)); `probara.attach()` is for everything else: a CSV a test wrote,
a response, a log.

```js
// cypress/e2e/cart.cy.js
it('writes the cart as CSV', () => {
  probara.attach({ name: 'cart.csv', body: 'sku,qty\nA-1,2\n' });
  probara.attach({ name: 'report.png', path: 'cypress/fixtures/report.png' });
});
```

| Argument      | What it is                                                                    |
| ------------- | ----------------------------------------------------------------------------- |
| `name`        | The name the file shows under in Probara.                                     |
| `body`        | The content: a string, a `Uint8Array` or an `ArrayBuffer`.                    |
| `path`        | A file of the project, read with `cy.readFile()`.                             |
| `contentType` | The type of the file; without one it is taken from the extension of its name. |

## A body

A string is attached as it is; bytes (a `Uint8Array`, an `ArrayBuffer` or a view of one) are
converted to base64 by the browser and written by the plugin. The call returns nothing: there is no
command to wait for.

## A path

A relative path is read from the project root, which is the rule of `cy.readFile()` (and not the
directory of the spec). The bytes have to reach the plugin, which is the only process that writes
files, so the call queues a `cy.readFile()` and returns **its chain**: wait for it when the test
needs to know that the file is attached.

```js
it('attaches a file of the project', () => {
  probara.attach({ name: 'cart.csv', path: 'cypress/fixtures/cart.csv' });
  cy.contains('Attached'); // the chain of probara.attach() yields the base64 of the file
});
```

The chain is a Cypress chain like any other: it can be returned, yielded or waited for with
`cy.wrap()`. A file that cannot be read fails the test the way `cy.readFile()` fails it, because the
command that reads it is the command that fails.

## Where a file belongs

A file attached inside a [`probara.step()`](steps.md) belongs to that step; any other belongs to the
result beside the steps. Every file of a result is uploaded once, under the name it was attached
with; a name with an extension keeps it, a name without one takes the extension of the file it came
from (`cart.csv`, or the `csv` of the name). `stdout.log` and `stderr.log` are the names
[`captureOutput`](configuration.md) attaches the console output of a test under.
