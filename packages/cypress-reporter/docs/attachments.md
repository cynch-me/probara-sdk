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

## Screenshots

Cypress takes a screenshot of a failed attempt by itself, and the reporter attaches it to the result
of **that** attempt: `attachScreenshots` (`PROBARA_ATTACH_SCREENSHOTS`) is on by default, and
`false` attaches none (Cypress still takes them, where it always does).

Nothing is matched by searching a folder. The plugin receives every screenshot Cypress takes with
`after:screenshot` and its exact path, and the reporter reads the name Cypress wrote in it:

| What Cypress names it                                   | What it is                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `<titles joined by ' -- '> (failed)`                    | The first failed attempt of a test                                                |
| `<titles joined by ' -- '> (failed) (attempt N)`        | The retry, from the second attempt on                                             |
| `<titles joined by ' -- '> -- <hook> hook (failed) (…)` | A failing `beforeEach`/`before`, named after the hook and the test it was running |

So each screenshot lands on the attempt it was taken for, and a test that fails twice has two. A
path that names no failed attempt of its spec — a `cy.screenshot('my-name')` of your own, for
instance — belongs to no result: it is left out, and named once at `PROBARA_DEBUG`
([troubleshooting](troubleshooting.md#a-screenshot-was-left-out)).

Because `after:screenshot` is a plugin event, screenshots are attached only when `setupNodeEvents`
is registered ([registration](configuration.md#registration)). The **video** of a spec is the other
way round: it is opt-in (`video: true` in the Cypress config and `attachVideos`), and one copy is
attached to every failed result of that spec ([specs](specs.md#the-video-of-a-spec)).

## Console output

`captureOutput: true` (`PROBARA_CAPTURE_OUTPUT`, off by default) attaches what each test writes to
the browser console, as two files of the result:

| Stream | What goes into it                              | Attached as                 |
| ------ | ---------------------------------------------- | --------------------------- |
| stdout | `console.log`, `console.info`, `console.debug` | `stdout.log` (`text/plain`) |
| stderr | `console.warn`, `console.error`                | `stderr.log` (`text/plain`) |

The support file wraps those five methods in a root `before` and wraps them again for each test, and
a root `afterEach` sends what the test wrote as one attachment per stream and puts the original
methods back. The browser console keeps printing everything, captured or not.

What is not captured: any other console method (`console.table`, `console.dir`, `console.group`,
`console.count`, `console.time`), a method the test replaced (the original is restored only where
its wrapper is still in place), and anything written outside a test — there is no buffer to write it
into.

Each stream is cut at 32 MiB: the text is kept up to a whole character and the attachment ends with

```text
[probara] The output of this test was cut here: an attachment holds at most 32 MiB
```

Without the support file nothing is captured and `captureOutput` has no effect: the capture is
installed by that file ([configuration](configuration.md#captureoutput)).

## Limits

The caps Probara holds every attachment to, of which the reporter skips a file rather than fail a
result. Every one of them is named in the run's log when it applies:

| Cap                                               | What it is                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 20 files per result                               | More than 20 attachments in one result are left out                                                         |
| 32 MiB per file                                   | The captured console output is cut at this size, with the line above                                        |
| 10 MiB per image                                  | A larger image is left out                                                                                  |
| 8192 px per side of an image                      | A larger image is left out (a full-page screenshot of a long page easily is)                                |
| Executables and scripts by content type           | A refused content type (`application/x-msdownload`, `application/x-sh`, `application/x-bat`, …) is left out |
| 255 characters in a stored file name              | A longer name is truncated                                                                                  |
| 20 links per result, 2048 characters per link URL | What the links of a result are held to ([links](links.md))                                                  |
| 200 steps per result, 10 levels deep              | What the steps of a result are held to ([steps](steps.md))                                                  |

Screenshots are typed `image/png` by the reporter and videos `video/mp4`, so Probara converts the
first as an image (thumbnail included) and stores the second as a file.

## Where a file belongs

A file attached inside a [`probara.step()`](steps.md) belongs to that step; any other belongs to the
result beside the steps. Every file of a result is uploaded once, under the name it was attached
with; a name with an extension keeps it, a name without one takes the extension of the file it came
from (`cart.csv`, or the `csv` of the name). `stdout.log` and `stderr.log` are the names
[`captureOutput`](configuration.md) attaches the console output of a test under.

## See also

- [Configuration](configuration.md): `attachScreenshots`, `attachVideos` and `captureOutput`.
- [Specs](specs.md): the screenshots a failed attempt produces, and the video of a spec.
