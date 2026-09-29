# Attachments

The CLI uploads the files a report points at (screenshots, traces, logs) to the result of their
test. With `--attach-output` it also attaches each test's output.

## Quick path

1. Make sure the files the report references still exist when the import runs (keep the test
   output folder as a CI artifact of the same job, or import in the same job).
2. Import as usual. The log ends with `Attached 7 files to results (0 skipped, 0 failed)`.
3. Too slow, or not wanted? Pass `--no-attachments`.

## How a report references a file

| In the report                                                                    | Written by                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A line `[[ATTACHMENT\|path]]` in the testcase's `<system-out>` or `<system-err>` | Playwright; any tool that prints it                        |
| A testcase property `<property name="probara_attachment" value="path"/>`         | pytest `record_property`, Playwright annotations, any tool |

- The `[[ATTACHMENT|...]]` marker must be alone on its line (spaces around it are fine). Lines in
  the output of each attempt (Playwright retries, Surefire reruns) count too.
- Several references are fine; the same path twice is uploaded once.
- Each file is sent with a content type from its extension (`.png`, `.jpg`, `.webp`, `.gif`,
  `.svg`, `.txt`, `.log`, `.md`, `.html`, `.csv`, `.json`, `.xml`, `.zip`, `.pdf`, `.webm`,
  `.mp4`), else as `application/octet-stream`.

```xml
<testsuites>
  <testsuite name="checkout">
    <testcase classname="checkout.CartTest" name="shows the cart" time="1.2">
      <properties>
        <property name="probara_attachment" value="screenshots/cart.png"/>
      </properties>
      <system-out>Rendering the cart
[[ATTACHMENT|logs/cart.log]]
</system-out>
    </testcase>
  </testsuite>
</testsuites>
```

<!-- dry-run -->

```text
passed	-	checkout.CartTest > shows the cart
Total: 1 result from 1 file (1 passed, 0 failed, 0 skipped, 0 blocked)
```

A dry run does not upload anything: it only warns about the files it cannot find.

### Where paths are looked up

1. An absolute path is used as is.
2. A relative path is looked up next to the XML file first (Playwright writes paths relative to
   its report), then in the current directory.
3. A file found in neither place is skipped with a warning naming the report, the path and the
   test: `reports/junit.xml: attachment "logs/cart.log" of "checkout.CartTest > shows the cart" was not found`.

## Test output

`--attach-output` attaches the testcase's `<system-out>` as `system-out.txt` and its `<system-err>`
as `system-err.txt`, without the `[[ATTACHMENT|...]]` lines. A stream with nothing left is not
attached.

- Only the output of the testcase itself is attached, not the output of each attempt that
  Playwright (`includeRetries`) and Surefire (reruns) write inside the attempt elements.
- Suite-level output is not attached (jest-junit's `includeConsoleOutput` writes only that).
- pytest writes output only with `-o junit_logging=all` (or `system-out`, `system-err`); gotestsum
  never writes any.

It is off by default: every result with files costs requests (see below), and output is often
large.

## Limits

These come from `@probara/core` ([its attachment rules](../../core/README.md#attachments)):

| Limit                  | What happens                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32 MiB per file        | A larger file is skipped with a warning                                                                                                                                                               |
| Images                 | PNG, JPEG and WebP over 10 MiB or 8192 px wide or tall are skipped with a warning                                                                                                                     |
| 20 files per result    | The files after the 20th are skipped, with one warning                                                                                                                                                |
| Empty or missing files | Skipped with a warning                                                                                                                                                                                |
| Rate limit             | Each result with files costs at least 2 requests (a stage and a commit) against the organization's API rate limit (60 requests per minute by default). `429` answers are retried after `Retry-After`. |

A result fanned out to several cases ([linking](linking.md#one-test-several-cases)) uploads its
files to each of them. `--attachment-concurrency` (1 to 8, default 2) sets how many results upload
at a time; lower it if uploads keep hitting the rate limit.

Uploads start once the reports are recorded. The run is closed after the last upload settled, so
files can still be staged into it.

## Turning uploads off

`--no-attachments` (or `PROBARA_UPLOAD_ATTACHMENTS=false`) uploads no file at all; the results are
sent as usual. `--attachments` turns them back on over the variable.

```bash
probara import junit reports/playwright.xml --no-attachments
```

## When an upload fails

- A **skipped** file (missing, too large, too many) is a warning. The exit code stays 0.
- A **failed** upload (the stage or commit request failed after its retries) keeps the results
  recorded, counts in `summary.attachments.failed`, and makes the command **exit 1**, so a CI step
  notices missing evidence. Running the import again sends every result and file again: into a
  new run, unless `--run-ulid` names the first one.

<!-- output: import -->

```text
$ probara import junit reports/playwright.xml
[probara] reports/playwright.xml: playwright, 13 results
[probara] Results: 13 (10 passed, 2 failed, 1 skipped, 0 blocked)
[probara] Project: SHOP
[probara] Run: new run "Automated run 2026-09-29 14:05 UTC"
[probara] Base URL: https://app.probara.net
[probara] Missing cases: created
[probara] Attachments: on
[probara] Recorded 13 results (12 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Attached 7 files to results (0 skipped, 0 failed)
```

## See also

- [JUnit mapping](junit.md#playwright): Playwright drops attachments that have no file.
- [Exit codes](exit-codes.md).
- [Troubleshooting: attachments are skipped](troubleshooting.md#attachments-are-skipped).
