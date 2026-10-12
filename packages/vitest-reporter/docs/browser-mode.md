# Browser mode

Tests that run in a browser ([Vitest's browser mode](https://vitest.dev/guide/browser/)) are
reported like tests that run in Node: the same keys, statuses, attempts and `probara.*` helpers.
The reporter still runs in Vitest's Node process, and the browser hands it what each test recorded.
A few things work differently, and a few do not work yet: each one warns, and none fails a test.

## Quick path

1. Install the provider of your Vitest version, at the same version as `vitest`, with
   `playwright`, then Playwright's Chromium (`npx playwright install chromium`):

   | Vitest         | Provider package             | `provider` in `test.browser`                               |
   | -------------- | ---------------------------- | ---------------------------------------------------------- |
   | 3.2            | `@vitest/browser`            | `'playwright'`                                             |
   | 4.0, 4.1 and 5 | `@vitest/browser-playwright` | `playwright()`, imported from `@vitest/browser-playwright` |

2. Turn browser mode on in `test.browser`, next to the reporter, registered as for Node:

   | Key of `test.browser` | Value                        |
   | --------------------- | ---------------------------- |
   | `enabled`             | `true`                       |
   | `provider`            | the value of the table above |
   | `instances`           | `[{ browser: 'chromium' }]`  |

3. Run the tests as usual (`npx vitest run`). Nothing else goes in the config: the reporter adds
   the browser setup file of your Vitest version to each browser project.

The reporter is tested in headless Chromium with Vitest 3.2.7, 4.0.18, 4.1.11 and 5.0.2, each with
its provider at the same version. Its own browser tests, in a clone of the SDK, need that Chromium:
`pnpm --filter @probara/vitest-reporter exec playwright install chromium`.

## What works as in Node

| Feature                                                   | In a browser                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Results                                                   | The keys, statuses and attempts of a Node run: a test that moves between Node and the browser keeps its case |
| [Retries and repeats](retries.md)                         | Every attempt is a result                                                                                    |
| The [`probara.*` helpers](metadata.md)                    | The same import and the same calls: titles, comments, parameters, tags, links, [steps](steps.md), files      |
| [`captureOutput`](output.md)                              | The browser's console reaches Vitest, and each attempt gets its `stdout.log` and `stderr.log`                |
| [Failure screenshots](attachments.md#failure-screenshots) | Attached to the failed attempts; `attachScreenshots: false` leaves them out                                  |

## `probara.attach()` in a browser

- **Await it.** The browser hands the file or the body to Vitest's Node side, which copies it after
  the call returns. A copy that ends after its test ended is not attached, with one warning in
  Vitest's output that names the file and the test, and ends
  `Await probara.attach() before the test ends`.
- **A body** (a string, a `Uint8Array`) is sent as in Node.
- **A path is read by Vitest's Node side**, and only where Vite serves files, by the same rules as
  the project's own Vite:

  | The path                                                                           | What happens                                                                            |
  | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
  | Relative                                                                           | Resolved against the project's root (Vite's `root`), not the directory `vitest` runs in |
  | Inside the folders of `server.fs.allow` (by default, the project's workspace root) | Copied                                                                                  |
  | A file Vite denies: `.env` files, certificates and `.git`, by default              | Refused                                                                                 |
  | Listed in the project's own `server.fs.deny`                                       | Refused. That list replaces Vite's defaults: list `.env*` and `*.{crt,pem}` in it again |
  | A symlink in the project that points outside the folders Vite serves               | Refused: Vite judges the file the link points to                                        |

  A refused file is copied nowhere, and the test goes on. One warning names it:
  `probara.attach() did not attach "<name>": Vite does not serve "<file>" (server.fs.allow or server.fs.deny)`.

- **Old Vite versions.** The reporter asks the Vite that the project's Vitest runs with. Vite 5.0 to
  5.3 have only an older file check, which then decides, with one notice per `vitest` process:
  `Vite <version> has no isFileLoadingAllowed (it arrived in 5.4): the browser attach follows its isFileServingAllowed`.
  When Vite cannot be found from the project, a path is refused:
  `Vite's file rules are not reachable from this run, so "<file>" is not served`.
- **The command it uses.** `probara.attach()` calls a browser command the reporter adds to each
  browser project, `probaraAttach`; a command of yours with that name is replaced.

## Not supported yet

| Feature                                        | What happens                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`runCasesOnly`](run-selection.md)             | Not applied to a browser project: its tests all run and are reported, with one warning, `runCasesOnly does not apply in browser mode yet: the tests of project "<name>" run and are reported`                       |
| `probara.*` calls of a `test.concurrent` test  | Dropped, with one warning in Vitest's output, `probara.<helper>() is dropped in a concurrent test: ...`: a browser cannot tell which of the concurrent tests made a call, and a call is never given to another test |
| The console output of a `test.concurrent` test | Left out, with one warning, as in Node ([captured output](output.md))                                                                                                                                               |

Write the tests that call the helpers as sequential tests (`test`, not `test.concurrent`), or run
them in Node, where each concurrent test keeps its own calls.

## See also

- [Attachments](attachments.md): `probara.attach()`, Vitest annotations and screenshots.
- [Metadata](metadata.md#differences-from-the-jest-api): what differs from the Jest reporter.
- [Troubleshooting](troubleshooting.md#browser-mode): every browser-mode warning.
