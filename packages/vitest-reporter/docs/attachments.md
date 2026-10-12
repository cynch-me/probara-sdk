# Attachments

A result carries the files its attempt attached with `probara.attach()` and with Vitest's own
`context.annotate()`, and, in browser mode, the screenshots Vitest takes of a failure. With
`captureOutput`, the reporter also attaches each attempt's console output
([captured output](output.md)).

## `probara.attach()`

Give it a file on disk or a body, and await it. It works from anywhere a test runs: the test body,
a `beforeEach` or `afterEach` hook, `onTestFinished`, a step, a helper or a page object the test
calls.

<!-- project: attach -->

```ts
// tests/receipt.test.ts
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('prints the receipt', async () => {
  const path = join(tmpdir(), 'receipt.txt');
  writeFileSync(path, 'Total: 25.00');
  await probara.attach({ name: 'receipt', path });
  await probara.attach({
    name: 'order',
    body: JSON.stringify({ id: 1042, total: 25 }),
    contentType: 'application/json',
  });
  await probara.attach({ name: 'log', body: 'paid in 1.2 s' });
});
```

<!-- files: attach -->

```text
receipt.txt text/plain
order.json application/json
log.txt text/plain
```

| Field         | With `path`                                                                   | With `body`                                                                                                     |
| ------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `name`        | Required: the name in Probara; the file's extension is added when it has none | Required: the name in Probara; the content type's extension is added when it has none                           |
| `path`        | The file, absolute or relative to the directory `vitest` runs in              | —                                                                                                               |
| `body`        | —                                                                             | A string, a `Buffer` or a `Uint8Array`, sent as it is                                                           |
| `contentType` | Optional: guessed from the file name                                          | Optional: guessed from `name`'s extension, else `text/plain` for a string, `application/octet-stream` for bytes |

- **Copied when called.** The file (or the body) is copied at once, so a test can delete or
  overwrite it right after: what Probara gets is what it was at the call.
- **Await it.** In Node the copy is made before the call returns; in browser mode it ends when the
  promise settles, and a copy that ends after its test ended is not attached, with a warning that
  says `Await probara.attach() before the test ends`.
- **A string is sent as it is**, as UTF-8 text, never decoded: pass a `Buffer` or a `Uint8Array`
  for binary content.
- **A file that cannot be attached** (it does not exist, it is a folder, it is larger than 32 MiB)
  is one warning, such as `probara.attach() did not attach "receipt": it does not exist`; the test
  goes on, and its result is sent.
- **Each attempt has its own files**: a retried test uploads the files of every attempt, each to its
  own result.

## Files of a step

A file attached while a [`probara.step()`](steps.md) runs goes to that step, and Probara shows it
under the step:

<!-- project: step-files -->

```ts
// tests/upload.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('uploads an avatar', async () => {
  await probara.step('Choose the file', async () => {
    await probara.attach({ name: 'avatar.png', body: new Uint8Array([137, 80, 78, 71]) });
  });
});
```

<!-- files: step-files -->

```text
avatar.png image/png
```

## Vitest annotations

The files of Vitest's `context.annotate(message, attachment)` are sent with the attempt that made
them, named by the annotation's message. The message itself is not sent:
[`probara.comment()`](metadata.md#comment) writes a note.

<!-- project: annotate -->

```ts
// tests/export.test.ts
import { test } from 'vitest';

test('exports the report', async ({ annotate }) => {
  await annotate('summary', { body: 'Exported 3 rows', bodyEncoding: 'utf-8' });
});
```

<!-- files: annotate -->

```text
summary.txt text/plain
```

| Vitest             | A text `body`                                                         | Binary content                                                                                    |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 4.1.3 and later, 5 | Pass `bodyEncoding: 'utf-8'`: without it, Vitest labels a body base64 | A `Uint8Array` body with its `contentType`, or a `path`                                           |
| 3.2, 4.0 to 4.1.2  | As it is: no `bodyEncoding` yet                                       | A `path`: Vitest 3 loses some bytes of a binary body, and such a body is left out, with a warning |

A `path` is copied by Vitest into its `attachmentsDir`, and the file in Probara gets the
annotation's message and the path's extension: `annotate('screen', { path: 'shot.png' })` is
`screen.png`. Vitest refuses `annotate()` once the test body ended: in `afterEach` and
`onTestFinished`, use `probara.attach()`.

## Failure screenshots

In browser mode, Vitest takes a screenshot when a test fails, and the reporter attaches it to the
failed execution, `image/png`: the first screenshot to the first failed attempt, and so on, or every
screenshot to the last failed attempt when their counts differ. `attachScreenshots: false`
(`PROBARA_ATTACH_SCREENSHOTS=false`) leaves them out. A test that runs in Node has none.

## Limits and what is skipped

| Limit                                      | What happens                                               |
| ------------------------------------------ | ---------------------------------------------------------- |
| 32 MiB per file or body                    | A larger one is skipped, with a warning                    |
| 20 files per result                        | The files after the first 20 are skipped, with one warning |
| Images over 10 MiB or 8192 px wide or tall | Skipped with a warning (Probara converts images to WebP)   |
| Executables and scripts                    | Skipped: Probara refuses their content types               |
| A missing, unreadable or empty file        | Skipped with a warning                                     |
| A result that recorded nothing             | Its files are not uploaded                                 |

Warnings name the file, and the log ends with how many files were attached, skipped and failed.
`uploadAttachments: false` (`PROBARA_UPLOAD_ATTACHMENTS=false`) uploads none. Files upload after
their report is recorded, while the run is still open, then the run is closed.

## Where the copies are kept

The reporter keeps its copies in `<attachmentsDir>/probara/<id>/`, under Vitest's
`attachmentsDir` (`.vitest-attachments` on Vitest 3 and 4, `.vitest/attachments` on Vitest 5, by
default), until they are sent:

| The run                                                                           | Its copies                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Every reporter is one Vitest ships (`default`, `verbose`, `junit`...) or this one | Removed once the run is sent                              |
| A shard (`--shard`), a run with `blob`, or any other reporter                     | Kept: a blob may name them, and a merge reads them        |
| Results that could not be sent, with `resultsFile`                                | Copied next to the results file, in `<name>-attachments/` |

- **Register the reporter by its package name**, `'@probara/vitest-reporter'`. Given by a path or as
  an object, it counts as another reporter, and its copies are kept.
- **Carry `attachmentsDir` with the blobs.** The blob of a shard names the files it attached by
  their place on the shard's machine: copy the shard's `attachmentsDir` along with its blob to the
  job that runs `vitest --merge-reports`, at the same path. A file the merge cannot find is skipped
  with the warning `Skipped an attachment: its file is missing or unreadable`, and its result is
  sent all the same.
- **Vitest's own copies** of annotation paths stay in `attachmentsDir`: Vitest never removes them,
  and neither does the reporter. Remove the folder when it grows.

## See also

- [Captured output](output.md): `stdout.log` and `stderr.log` of each attempt.
- [Steps](steps.md): which step a file goes to.
- [Retries and repeats](retries.md): the files of each attempt.
