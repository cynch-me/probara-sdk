# Attachments

A test attaches files to its result with `probara.attach()`, and the reporter can attach each
attempt's console output. Jest records no files of its own (no screenshots, no traces): what a
result carries is what the test attached.

## `probara.attach()`

Give it a file on disk or a body. It works from anywhere a test runs: the test body, a
`beforeEach` or `afterEach` hook, a helper or a page object the test calls.

<!-- project: attach -->

```js
// tests/receipt.test.js
const { writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { probara } = require('@probara/jest-reporter');

test('prints the receipt', () => {
  const path = join(tmpdir(), 'receipt.txt');
  writeFileSync(path, 'Total: 25.00');
  probara.attach({ name: 'receipt', path });
  probara.attach({
    name: 'order',
    body: JSON.stringify({ id: 1042, total: 25 }),
    contentType: 'application/json',
  });
  probara.attach({ name: 'log', body: 'paid in 1.2 s' });
});
```

<!-- files: attach -->

```text
receipt.txt text/plain
order.json application/json
log.txt text/plain
```

| Field         | With `path`                                                                   | With `body`                                                                           |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `name`        | Required: the name in Probara; the file's extension is added when it has none | Required: the name in Probara; the content type's extension is added when it has none |
| `path`        | The file, absolute or relative to the directory `jest` runs in                | —                                                                                     |
| `body`        | —                                                                             | A string, a `Buffer` or a `Uint8Array`, sent as it is                                 |
| `contentType` | Optional: guessed from the file name                                          | Optional: `text/plain` for a string, `application/octet-stream` for bytes             |

- **Copied when called.** The file (or the body) is copied at once, so a test can delete or
  overwrite it right after: what Probara gets is what it was at the call. `probara.attach()`
  returns a promise that is already resolved; awaiting it is harmless.
- **A string is sent as it is**, never decoded: pass a `Buffer` for binary content.
- **A file that cannot be attached** (it does not exist, say) is a `[probara]` warning in the
  reporter's log; the test goes on.
- **Each attempt has its own files**: a retried test uploads the files of every attempt, each to its
  own result.

## Files of a step

A file attached while a [`probara.step()`](steps.md) runs goes to that step, and Probara shows it
under the step:

<!-- project: step-files -->

```js
// tests/upload.test.js
const { probara } = require('@probara/jest-reporter');

test('uploads an avatar', async () => {
  await probara.step('Choose the file', async () => {
    probara.attach({
      name: 'avatar',
      body: Buffer.from([137, 80, 78, 71]),
      contentType: 'image/png',
    });
  });
});
```

<!-- files: step-files -->

```text
avatar.png image/png
```

## Console output

With `captureOutput: true` (`PROBARA_CAPTURE_OUTPUT=true`) and the reporter's setup file, each
attempt's console output is attached as `stdout.log` (`console.log`, `console.info`,
`console.debug`) and `stderr.log` (`console.warn`, `console.error`), when there is any, its
`beforeEach` and `afterEach` hooks included:

<!-- project: output -->

```js
reporters: ['default', ['@probara/jest-reporter', { captureOutput: true }]],
setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
```

<!-- project: output -->

```js
// tests/logs.test.js
beforeEach(() => {
  console.info('Seeding the cart');
});

test('prints what it does', () => {
  console.log('Opening the cart');
  console.error('Slow response: 2.1 s');
});
```

<!-- files: output -->

```text
stdout.log text/plain
stderr.log text/plain
```

Jest still prints the output as usual. The setup file wraps the console of each test file, in
every worker; without it, the tests run and are reported without their output, with one warning
([`captureOutput`](configuration.md#captureoutput)).

| Not captured                                                                   | Why                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `console.dir`, `table`, `group`, `count`, `time`, `timeEnd`, `trace`, `assert` | Only the five methods above are wrapped                            |
| `process.stdout.write`, `process.stderr.write`                                 | They bypass the console                                            |
| Output of `test.concurrent` tests                                              | Their bodies run outside the `beforeEach`/`afterEach` of each test |
| A console the test replaced (`jest.spyOn(console, 'log')` with a mock)         | The test's own console receives the calls                          |
| Output in `beforeAll`, `afterAll`, a `describe` body or the module scope       | No single test runs there                                          |

Each stream is cut at 32 MiB, the largest file Probara takes, with a last line that says it was
cut.

## Limits and what is skipped

| Limit                                      | What happens                                               |
| ------------------------------------------ | ---------------------------------------------------------- |
| 32 MiB per file                            | A larger file is skipped with a warning                    |
| 20 files per result                        | The files after the first 20 are skipped, with one warning |
| Images over 10 MiB or 8192 px wide or tall | Skipped with a warning (Probara converts images to WebP)   |
| Executables and scripts                    | Skipped: Probara refuses their content types               |
| A missing, unreadable or empty file        | Skipped with a warning                                     |
| A result that recorded nothing             | Its files are not uploaded                                 |

Warnings name the file, and the log ends with how many files were attached, skipped and failed.
`uploadAttachments: false` (`PROBARA_UPLOAD_ATTACHMENTS=false`) uploads none. Every result with
files costs two more requests against the organization's rate limit
([network](network.md#rate-limit)).

Files upload after their report is recorded, while the run is still open, then the run is closed.
Until then, the reporter keeps its copies in a folder of the system's temporary directory, removed
when `jest` ends; with a [results file](results-file.md), the copies of what was not sent are kept
next to it.

## See also

- [Steps](steps.md): which step a file goes to.
- [Troubleshooting](troubleshooting.md#an-attachment-is-missing).
