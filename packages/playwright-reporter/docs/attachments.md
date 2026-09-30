# Attachments

Every file of an attempt goes to its result in Probara: what Playwright records on its own, and
what a test attaches. Nothing needs to be turned on in the reporter.

## What Playwright records

Turn them on in `use`, as usual; the reporter uploads what they produce:

```ts
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
  trace: 'retain-on-failure',
},
```

| Playwright                                   | The file in Probara                                   |
| -------------------------------------------- | ----------------------------------------------------- |
| `screenshot`                                 | `test-failed-1.png` (and the others Playwright keeps) |
| `video`                                      | The `.webm` video of the attempt                      |
| `trace`                                      | `trace.zip`: open it with `npx playwright show-trace` |
| A failed attempt (Playwright 1.51 and later) | `error-context.md`: the page snapshot at the failure  |
| `toHaveScreenshot()` failures                | The expected, actual and diff images                  |

Each attempt has its own files, so a retried test uploads the files of every attempt, each to its
own result.

## `testInfo.attach()`

Playwright's own API works as it is, with a file or a body:

<!-- project: attach -->

```ts
// tests/api.spec.ts
import { test } from '@playwright/test';

test('creates an order', async ({ page }, testInfo) => {
  await testInfo.attach('order', {
    body: JSON.stringify({ id: 1042, total: 25 }),
    contentType: 'application/json',
  });
  await testInfo.attach('checkout', { body: await page.screenshot(), contentType: 'image/png' });
});
```

The files are named after the attachment, with the extension of their content type:

<!-- files: attach -->

```text
order.json application/json
checkout.png image/png
```

## `probara.attach()`

`probara.attach()` does the same from anywhere a test runs (a helper, a fixture, a page object),
without passing `testInfo` around. Give it a file on disk or a body, and await it:

<!-- project: probara-attach -->

```ts
// tests/receipt.spec.ts
import { writeFile } from 'node:fs/promises';
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('prints the receipt', async () => {
  const path = test.info().outputPath('receipt.txt');
  await writeFile(path, 'Total: 25.00');
  await probara.attach({ name: 'receipt.txt', path });
  await probara.attach({ name: 'log', body: 'paid in 1.2 s', contentType: 'text/plain' });
});
```

<!-- files: probara-attach -->

```text
receipt.txt text/plain
log.txt text/plain
```

| Field         | With `path`                               | With `body`                            |
| ------------- | ----------------------------------------- | -------------------------------------- |
| `name`        | Required: the name in Probara             | Required: the name in Probara          |
| `path`        | The file to attach (Playwright copies it) | —                                      |
| `body`        | —                                         | A string, a `Buffer` or a `Uint8Array` |
| `contentType` | Optional: guessed from the file name      | Required, such as `text/plain`         |

A file that cannot be attached (it does not exist, say) is a `[probara]` warning on the test's
stderr; the test goes on.

## Files of a step

A file attached while a `test.step` runs goes to that step, and Probara shows it under the step:

<!-- project: step-files -->

```ts
// tests/upload.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('uploads an avatar', async ({ page }) => {
  await test.step('Choose the file', async () => {
    await probara.attach({
      name: 'avatar',
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
```

<!-- files: step-files -->

```text
avatar.png image/png
```

With Playwright 1.42 to 1.49 every file stays with the result: Playwright does not say which step
a file belongs to before 1.50. A file attached inside a hook or a fixture that is not a
`test.step` goes to the nearest `test.step` around it, or to the result.

## File names

A file keeps its own name (`test-failed-1.png`, `trace.zip`). Playwright stores what
`testInfo.attach()` copies under a hashed name (`receipt-<sha1>.txt`), and a merged blob report
stores every file that way; such a file is named after its attachment instead, with the file's
extension when the name has none: `receipt.txt`, `avatar.png`.

## Test output

With `captureOutput: true` (`PROBARA_CAPTURE_OUTPUT=true`), each attempt's stdout and stderr are
attached as `stdout.log` and `stderr.log`, when there is any:

<!-- project: output -->

```ts
reporter: [['@probara/playwright-reporter', { captureOutput: true }]],
```

<!-- project: output -->

```ts
// tests/logs.spec.ts
import { test } from '@playwright/test';

test('prints what it does', async () => {
  console.log('Opening the cart');
  console.error('Slow response: 2.1 s');
});
```

<!-- files: output -->

```text
stdout.log text/plain
stderr.log text/plain
```

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
files costs two more requests against the organization's rate limit ([network](network.md)).

Files upload after their report is recorded, while the run is still open, then the run is closed.
Keep Playwright's output folder (`test-results/`) until the reporter is done: it uploads from
there.

## See also

- [Steps](steps.md): which steps files go to.
- [Troubleshooting](troubleshooting.md#an-attachment-is-missing).
