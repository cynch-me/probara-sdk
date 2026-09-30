# @probara/core

The base library every Probara adapter builds on. You create a reporter, hand it each finished
test, and call `complete()`. Core takes care of the rest:

- reading configuration from options and `PROBARA_*` variables,
- detecting the CI build,
- building the automation key,
- keeping every field inside the API limits,
- chunking, retries, and the final summary.

A reporting failure never throws into the test framework.

## Install

```bash
npm i @probara/core
```

## Quick path

1. Set `PROBARA_API_TOKEN` and `PROBARA_PROJECT` in CI. Without them the reporter stays off and
   quiet. The token is an app token: in Probara, an admin or owner opens **Integrations**, picks
   the **JUnit XML** card and creates one (the secret starts with `probara_app_` and is shown
   once). Reporting from CI needs a paid plan; on the free plan Probara answers `403 forbidden`.
2. Call `createReporter()` when the run starts, `addResult()` for each test, and
   `await complete()` at the end.
3. Look for the log line `[probara] Recorded 120 results (3 new cases, 2 unmatched) in R-12 (closed): <url>`.

## Writing an adapter

Here is a minimal Playwright reporter. The official Playwright reporter is planned; this sketch
shows the contract. It is [`examples/playwright-reporter.ts`](examples/playwright-reporter.ts),
type-checked against the current source and `@playwright/test` by `pnpm typecheck`.

```ts
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { createReporter, type ProbaraReporter, type ResultStatus } from '@probara/core';

const STATUS: Record<TestResult['status'], ResultStatus> = {
  passed: 'passed',
  failed: 'failed',
  timedOut: 'failed',
  interrupted: 'blocked',
  skipped: 'skipped',
};

export default class ProbaraPlaywrightReporter implements Reporter {
  private probara: ProbaraReporter | undefined;

  onBegin(): void {
    this.probara = createReporter({ clientName: 'my-playwright-adapter/0.1.0' });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.probara?.addResult({
      identity: {
        file: test.location.file,
        // [root, project, file, ...describes, title] -> [...describes, title]
        titlePath: test.titlePath().slice(3),
        parameters: { project: test.parent.project()?.name ?? '' },
      },
      status: STATUS[result.status],
      durationMs: result.duration,
      startedAt: result.startTime,
      ...(result.error === undefined ? {} : { error: result.error }),
      // Screenshots, traces, videos: uploaded after the result is recorded.
      attachments: result.attachments,
    });
  }

  async onEnd(): Promise<void> {
    const summary = await this.probara?.complete();
    if (summary !== undefined && summary.status !== 'disabled') {
      console.log(`Probara: ${summary.status}, ${summary.recorded} recorded`);
    }
  }
}
```

The reporter API:

| Member             | What it does                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `enabled`          | `false` when reporting is off, not configured, or misconfigured                         |
| `addResult(input)` | Queues one test. Synchronous, never throws. Invalid input is counted.                   |
| `complete()`       | Sends what is left and resolves the summary. Never rejects. Same promise on every call. |

### `TestResultInput`

| Field            | Required | Notes                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `identity`       | yes      | `{ file?, titlePath, parameters? }`, which builds the automation key                        |
| `status`         | yes      | `passed`, `failed`, `skipped` or `blocked`                                                  |
| `caseDisplayId`  | no       | Explicit link such as `PRB-12`. The server treats it as authoritative.                      |
| `caseDisplayIds` | no       | More links: the result is sent once per case (see [several cases](#one-test-several-cases)) |
| `automationKey`  | no       | Replaces the built key (see below)                                                          |
| `title`          | no       | Title of a created case. Defaults to the last title segment.                                |
| `suitePath`      | no       | Suites of a created case. Defaults to the file, then the describes.                         |
| `durationMs`     | no       | Rounded, never negative                                                                     |
| `startedAt`      | no       | `Date`, ISO string or epoch ms, sent as `executedAt` (see below)                            |
| `error`          | no       | A string or `{ message?, stack? }`, written into the notes                                  |
| `notes`          | no       | Extra text, added after the error                                                           |
| `attachments`    | no       | Files `{ name?, contentType?, path?, body? }` (see [Attachments](#attachments))             |

#### One test, several cases

A test that covers several cases passes them all: `caseDisplayId`, then every id of
`caseDisplayIds`, trimmed, once each (blank ones are ignored). The reporter sends one entry per
case, one after another, each with the same automation key, status, duration and notes, and
uploads the attachments to the result of each case. Each entry counts towards `chunkSize` and the
summary like any other result.

```ts
reporter.addResult({ identity, status: 'passed', caseDisplayIds: ['PRB-12', 'PRB-13'] });
// sends two entries with the same key: one for PRB-12, one for PRB-13
```

`fanOutByCase(input)` gives the same split, for an adapter that counts or prints what is sent.
`toReportEntry` converts one case at a time: it throws a `TypeError` for an input that links
several cases.

A `startedAt` string without a UTC offset (`2026-09-29T14:05:00`) is parsed as the host's local
time, so the same string means another instant on a machine in another time zone. Pass a `Date`
or epoch ms, or a string with `Z` or an offset.

### The summary

`complete()` resolves a `ReportSummary`:

| Field              | Meaning                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `status`           | `disabled`, `empty`, `completed`, `partial` or `failed`                                                |
| `run`              | `{ ulid, displayId, state, url }` once a report was recorded                                           |
| `recorded`         | Results recorded in the run                                                                            |
| `created`          | Cases the reports created                                                                              |
| `unmatched`        | `{ reason, automationKey?, caseDisplayId?, title? }` for each result that recorded nothing             |
| `invalid`          | Inputs `addResult` could not convert (adapter bugs). These are never sent.                             |
| `filtered`         | Results left out by `statusFilter` ([statuses](#status-mapping-and-filter)), one per case. Never sent. |
| `notSent`          | Results that did not reach Probara: the failed report and every one after it                           |
| `errors`           | `{ message, code?, status? }` for config problems, failed reports and a failed close                   |
| `attachments`      | `{ uploaded, skipped, failed }`: files of the results (see [Attachments](#attachments))                |
| `attachmentErrors` | `{ message, code?, status? }` for failed stage and commit requests                                     |

## Configuration

Precedence is **options > environment > defaults**. An option set to `undefined` never overrides
the environment. Booleans accept `true/1/yes/on` and `false/0/no/off`.

| Option                   | Variable                                                | Default                                                              |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `enabled`                | `PROBARA_ENABLED`                                       | on (`false` turns reporting off)                                     |
| `apiToken`               | `PROBARA_API_TOKEN`                                     | none (required). An app token: see the quick path.                   |
| `projectId`              | `PROBARA_PROJECT`                                       | none (required). The project code, such as `SHOP`.                   |
| `baseUrl`                | `PROBARA_BASE_URL`                                      | `https://app.probara.net`                                            |
| `run.ulid`               | `PROBARA_RUN_ULID`                                      | none, so core creates a run                                          |
| `run.name`               | `PROBARA_RUN_NAME`                                      | the CI build name (`CI #42`), else `Automated run <date> <time> UTC` |
| `run.environmentId`      | `PROBARA_ENVIRONMENT_ID`                                | none                                                                 |
| `run.milestoneId`        | `PROBARA_MILESTONE_ID`                                  | none                                                                 |
| `run.configurationUlids` | `PROBARA_CONFIGURATION_ULIDS`                           | none (comma-separated)                                               |
| `run.tags`               | `PROBARA_RUN_TAGS`                                      | none (comma-separated)                                               |
| `source`                 | `PROBARA_BRANCH`, `PROBARA_COMMIT`, `PROBARA_BUILD_URL` | detected from CI. A blank field is unset. `false` sends none.        |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES`                          | `true`                                                               |
| `suiteUlid`              | `PROBARA_SUITE_ULID`                                    | the project root                                                     |
| `closeRun`               | `PROBARA_CLOSE_RUN`                                     | `true` for a created run, `false` for a reused one                   |
| `debug`                  | `PROBARA_DEBUG`                                         | `false`                                                              |
| `rootDir`                | none                                                    | `process.cwd()`. File paths in keys are relative to it.              |
| `clientName`             | none                                                    | none. Sent first in the User-Agent.                                  |
| `chunkSize`              | none                                                    | `500` (1..500)                                                       |
| `timeoutMs`              | none                                                    | `30000` per attempt, body included (1..600000)                       |
| `maxRetries`             | none                                                    | `4` (0..10)                                                          |
| `uploadAttachments`      | `PROBARA_UPLOAD_ATTACHMENTS`                            | `true`. `false` uploads no attachment.                               |
| `attachmentConcurrency`  | none                                                    | `2` results uploading at a time (1..8)                               |
| `statusMapping`          | `PROBARA_STATUS_MAPPING`                                | none ([statuses](#status-mapping-and-filter))                        |
| `statusFilter`           | `PROBARA_STATUS_FILTER`                                 | none ([statuses](#status-mapping-and-filter))                        |

The options for creating a run (`run.name`, `run.environmentId`, and the others) are ignored, with
a warning, when `run.ulid` is set.

What happens with each setup:

| Setup                                        | Result                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| No token and no project, or `enabled: false` | Disabled. Nothing is sent, and core logs at debug only.                        |
| Only one of them, or an invalid value        | Reporting is off. Each problem is logged at error, and the status is `failed`. |
| Both valid                                   | Enabled                                                                        |

An option of the wrong type (such as `run.tags: 'nightly'` instead of a list) is an invalid value:
it turns reporting off with a problem, and never throws. A `source` field that is not a string is
only dropped, with a warning, like any other invalid source field.

### Status mapping and filter

`statusMapping` changes the status results are sent with, and `statusFilter` leaves results out by
status. The mapping applies first, so the filter sees the mapped status:

```ts
createReporter({
  statusMapping: { failed: 'blocked', skipped: 'passed' }, // from -> to
  statusFilter: ['passed'], // not sent
});
```

The same as variables: `PROBARA_STATUS_MAPPING=failed=blocked,skipped=passed` and
`PROBARA_STATUS_FILTER=passed` (comma-separated, trimmed, in any case). Both take the four statuses
`passed`, `failed`, `skipped` and `blocked`. An unknown status, an entry that is not
`<status>=<status>`, or a status mapped twice is an invalid value: reporting is off with a problem.
Filtered results are counted in the summary's `filtered` (one per case) and logged at info; they
upload no attachment.

`createReporter` also accepts test seams: `logger`, `env`, `fetch`, `sleep`, `random` and `now`.

## The automation key (v1)

The key links a test to its Probara case. Every adapter must build the same key for the same test,
so the algorithm is **frozen**. Golden vectors in `src/automation-key.test.ts` pin it: changing
the algorithm would unlink every case already reported.

1. `file`: an absolute path is made relative to `rootDir`, `\` becomes `/`, repeated `/` collapse,
   and a leading `./` is removed.
2. Each `titlePath` segment is NFC-normalized (lone surrogates become U+FFFD), control characters
   and whitespace runs become one space, and the segment is trimmed. Empty segments are dropped.
3. `parameters` are sorted by name (names that normalize alike by value) and appended to the last
   segment:
   `logs in [browser=chromium, locale=es]`.
4. The file and the segments are joined with `>`. Case is preserved.
5. A key over 1024 characters keeps its first 1006, then gets ` #` and 16 hex characters of its
   SHA-256.

Example: `e2e/login.spec.ts > Login > logs in [browser=chromium]`.
`buildAutomationKey(identity, { rootDir })` exposes the same function.

How the server matches each result:

| You send                  | Matching                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| identity only             | By the built key. An unknown key with a title creates the case (unless `createMissingCases: false`). |
| `caseDisplayId: 'PRB-12'` | By display id (authoritative). A case without a key adopts the entry's key.                          |
| `automationKey: '...'`    | By your key instead of the built one. It is normalized and fitted to 1024 characters.                |

### Case ids in titles

A test can name its case in its title (`PRB-12 logs in`). Remove the id before building the key,
so adding or removing it never changes the key, and send it as the case link. Every adapter uses
the same helpers, so a Playwright title and its JUnit testcase name give the same key:

| Helper                                            | What it does                                                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractCaseIds(text, projectCode)`               | Finds the `<CODE>-<n>` and `<CODE>_<n>` tokens of that project (case-sensitive, not glued to a letter or digit, optionally in `[]`, `()` or after `@`) and removes them, with the separators and emptied brackets they leave behind |
| `extractTitlePathCaseIds(titlePath, projectCode)` | The same on every segment. A segment left blank is dropped; when only ids are left, the segments are kept as they were.                                                                                                             |
| `parseCaseIdList(value)`                          | The ids of a comma-separated list (a `probara_case` property or annotation), trimmed, once each, as written                                                                                                                         |
| `parseCaseDisplayId(id)`                          | `{ projectCode, number }` of a well-formed display id (`WEB-3`), else `undefined`                                                                                                                                                   |

```ts
extractCaseIds('[PRB-12] logs in (@PRB-13)', 'PRB'); // { text: 'logs in', ids: ['PRB-12', 'PRB-13'] }
extractCaseIds('SHOP-4 logs in', 'PRB'); // { text: 'SHOP-4 logs in', ids: [] }: another project's
parseCaseIdList(' PRB-12, WEB-3 ,PRB-12'); // ['PRB-12', 'WEB-3']
```

Without a project code, `extractCaseIds` finds nothing: only the ids of the project you report
into are read from a title.

## What core normalizes

A single field outside the contract makes the API reject the whole report with 422. Core keeps
every entry inside the limits, so an adapter never causes that. Lone (unpaired) surrogates in any
text field become U+FFFD, so the body is always valid UTF-8:

| Field                 | Limit                            | Core does                                                                         |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `status`, `titlePath` | known status, at least one title | Otherwise the result is counted as `invalid` and not sent                         |
| `automationKey`       | 1..1024, no control characters   | Normalized. Too long gets a hash suffix. Blank falls back to the built key.       |
| `title`               | 1..400                           | Single line, cut with `…`                                                         |
| `suitePath`           | 10 levels of 1..255              | Levels past the 10th are merged into the last one with `>`, and each level is cut |
| `notes`               | 4000                             | ANSI stripped, error message and stack merged, cut with `…[truncated]`            |
| `caseDisplayId`       | 1..64                            | Blank or too long is dropped with a warning                                       |
| `durationMs`          | finite, 0 or more                | Rounded. A value that is not a number is dropped.                                 |
| `executedAt`          | RFC 3339 with offset             | Sent as UTC ISO. An invalid date is dropped.                                      |
| run name              | 1..200                           | Cut with a warning                                                                |
| run tags              | 50 of 1..80                      | Deduplicated and cut. Extra tags are dropped with a warning.                      |
| configuration ULIDs   | 20, valid ULIDs                  | Otherwise a config problem                                                        |
| `branch`              | 255, no control characters       | Cleaned. Too long is dropped.                                                     |
| `commit`              | 1..64 visible ASCII              | Otherwise dropped                                                                 |
| `buildUrl`            | http(s), 2048                    | Otherwise dropped                                                                 |

Warnings never echo the value they are about. The limits are exported (`MAX_TITLE_LENGTH`,
`ULID_PATTERN`, and the others).

## Chunking, closing and sharding

- Results go out in reports of `chunkSize` (500), strictly one after another, in the order they
  were added. The order matters because the run case keeps the last outcome.
- The first report creates the run. Later reports reuse its `ulid`.
- Only the **last** report carries `close: closeRun`, so the run closes after everything is in.
  With attachments, the run is closed on its own after the uploads instead (see
  [Attachments](#attachments)).
- Each report gets its own `Idempotency-Key`. Retries reuse it, so a retried report is replayed,
  never recorded twice.

### Sharded CI

Shards share one run in three steps: create the run once with `createRun`, give its ULID to every
shard as `PROBARA_RUN_ULID`, and close it once with `closeRun`, in a final job that runs after
every shard:

```bash
# 1. A first job, before the shards: writes the ULID of the new run to probara-run-ulid
#    (the log lines go to the console, so the file holds only the ULID)
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { createRun } from '@probara/core';
const summary = await createRun();
if (summary.status === 'created') writeFileSync('probara-run-ulid', summary.run.ulid);
else if (summary.status === 'disabled') console.warn('Probara reporting is disabled: no run was created and probara-run-ulid was not written');
else process.exitCode = 1;
"

# 2. Every shard, with the ULID of step 1 (pass the file's content on as a job output)
PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 <your test command> --shard=1/4

# 3. The final job, after the last shard (same PROBARA_API_TOKEN, PROBARA_PROJECT, PROBARA_RUN_ULID)
node --input-type=module -e "
import { closeRun } from '@probara/core';
const summary = await closeRun();
if (summary.status === 'failed') process.exitCode = 1;
"
```

On `disabled`, no run exists and no ULID is written: do not pass an empty `PROBARA_RUN_ULID` on
to the shards without knowing it (a shard with reporting on would then create a run of its own).

You can also create the run through the API (`POST /api/v1/projects/{projectId}/runs` with
`automated: true`, as `createRun` does) and share its ULID the same way. A run created in the
Probara app needs its cases picked up front.

#### `createRun(options)`

- reads the same settings as a reporter creating a run: `apiToken`, `projectId`, `baseUrl`,
  `run.name`, `run.environmentId`, `run.milestoneId`, `run.configurationUlids`, `run.tags`,
  `source`, `debug`, `clientName`, `timeoutMs`, `maxRetries`, and the seams `logger`, `env`,
  `fetch`, `sleep`, `random`, `now`;
- creates an **automated** run: the body carries `automated: true`, so the run starts without
  cases and the shards report theirs into it. It needs a Probara version that accepts automated
  runs; an older one rejects the request with 422 `validation_failed`, and `createRun` resolves
  `failed`;
- sends the run a report would create: the same default name (the CI build, such as `CI #42`,
  else `Automated run <date> <time> UTC`), the same limits on the name, tags and configuration
  ULIDs, and the same CI source (`PROBARA_BRANCH`, `PROBARA_COMMIT`, `PROBARA_BUILD_URL`, else the
  detected CI; `source: false` sends none);
- fails without a request when `run.ulid` or `PROBARA_RUN_ULID` is set: a run is already
  configured, so creating another is almost certainly a mistake;
- retries like a report, under one idempotency key;
- never rejects. It resolves a `CreateRunSummary`:

| `status`   | Meaning                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| `created`  | The run exists. `run` is `{ ulid, displayId, state, url }`. Logged at info.        |
| `disabled` | Reporting is off or not configured. Nothing was sent.                              |
| `failed`   | A config problem (a run already set included) or the creation failed: see `error`. |

When the creation failed after the request may have reached Probara (a network error, a timeout,
a 5xx, a `201` body that could not be read, or retries that ran out on an in-flight duplicate, a
409 `conflict` with `Retry-After`), the message says so and links the project's runs:
check them before creating another run.

#### `closeRun(options)`

With `PROBARA_RUN_ULID` set, `closeRun` defaults to `false` in the reporter, so no shard closes a
run that other shards are still writing to. The final `closeRun()` call:

- reads the same settings as a reporter (`apiToken`, `projectId`, `baseUrl`, `run.ulid`, `debug`,
  `clientName`, `timeoutMs`, `maxRetries`, and the seams `logger`, `env`, `fetch`, `sleep`,
  `random`, `now`). `run.ulid` / `PROBARA_RUN_ULID` is required, and `projectId` builds the run's
  page URL;
- retries like a report, under one idempotency key;
- never rejects. It resolves a `CloseRunSummary`:

| `status`         | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `closed`         | The run is closed. `run` is `{ ulid, displayId, state, url }`.                        |
| `already_closed` | The run was already closed or aborted (409 `conflict`). Logged at info, not an error. |
| `disabled`       | Reporting is off or not configured. Nothing was sent.                                 |
| `failed`         | A config problem (a missing run included) or the close failed: `error` says why.      |

A 409 `conflict` with `Retry-After` is an in-flight duplicate of the same idempotency key, not a
closed run: it is retried, and `failed` once the retries run out. A `200` that answers a run still
open is `failed` too (`invalid_response`). Options that are not an object (`closeRun(null)` from
untyped JavaScript, for example) resolve `failed` as well; `createReporter(null)` returns a
reporter that is off and completes `failed`.

Whether the job fails on `failed` is your choice: the snippet above sets a non-zero exit code.

## Attachments

`attachments` takes Playwright's `result.attachments` as is: `{ name?, contentType?, path?, body? }`,
where `body` is a `Uint8Array` (a `Buffer`) or a string. After a report records a result, core
uploads its files in two steps: it **stages** them (multipart `file` parts), then **commits** the
staged refs to the result at positions `0..n-1`.

- **File name**: the base name of `path`, else `name`, plus an extension from `contentType` when
  `name` has none (`screenshot` + `image/png` is `screenshot.png`). One line, no path separators,
  at most 255 characters.
- **Content**: a `path` is opened with `fs.openAsBlob` when its result uploads and streamed, never
  read into memory whole. `path` wins over `body`. A missing `contentType` is sent as
  `application/octet-stream`.
- **Skipped, with a warning**: a missing, unreadable or empty file, a file over 32 MiB, an
  attachment with neither `path` nor `body`, a content type the server refuses (executables and
  scripts, such as `application/x-sh`), and every uploadable file beyond the first 20 of a result
  (one warning with the count; a skipped file does not use up one of the 20). Attachments of a
  result that was not recorded (unmatched, or its report failed) are skipped too.
- **Images**: Probara converts `image/png`, `image/jpeg` and `image/webp` attachments (by their
  `contentType`) to WebP and refuses one over 10 MiB or over 8192 px wide or tall. Core skips such
  an image with a warning naming the file and its size or dimensions, read from the file header
  (only its first 256 KiB). A full-page screenshot of a long page is the usual case. An image whose
  dimensions are not found there is sent, and the server decides. Any other type, and an image
  sent as `application/octet-stream`, is stored as a plain file up to 32 MiB.
- **Requests**: stage requests hold at most 20 files and 64 MiB, so a request stays under the
  100 MB body limit of the server's platform. A stage request carries no `Idempotency-Key` (the
  server ignores it there; a retry is safe because unreferenced staged files expire) and its body
  is rebuilt on every attempt. Each upload attempt may take `max(timeoutMs, 120000)` ms, so a large
  file on a slow link is not cut off. The commit is retried under one `Idempotency-Key`.
- **Rate limit**: every result with attachments costs at least 2 more requests (a stage and a
  commit; one more stage per extra 20 files or 64 MiB) against the organization's API rate limit
  (60 requests per minute by default). `429` answers are retried after `Retry-After`. Lower
  `attachmentConcurrency` (default 2, 1..8) to spread them, or set `uploadAttachments: false`.
- **Ordering**: reports stay strictly sequential. Uploads start once their report is recorded, and
  yield to reports: while a report is queued or in flight, no new stage or commit request starts
  (one already in flight finishes), so uploads never hold back a report under the shared rate
  limit. They resume once the reports settled. When results arrive faster than reports drain
  (for example a large JUnit import added at once), uploads wait until the last report and then
  run at `attachmentConcurrency`, retrying `429` answers.
- **Closing**: files can only be staged into an open run. When any attachment was queued, the last
  report leaves the run open, and once every upload settled core closes the run on its own
  (`POST /api/v1/runs/{runUlid}/close`), only when `closeRun` is on and every report was recorded.
  A run already closed or aborted meanwhile is fine: it is logged, and `run.state` is `closed`
  (Probara stores an aborted run as closed). Without attachments the last report closes the run, as before.
- **One bad file does not sink the others**: the server refuses a whole stage request for its
  first invalid file (422). Core then sends each file of that request on its own (with the usual
  retries), so only the refused files fail; the staged ones are still committed. Any other failure
  stops the uploads of that result, and the files staged before it are committed.
- **Failures never change `status`**: a failed stage or commit counts its files in
  `attachments.failed` and adds an entry to `attachmentErrors`. The results stay recorded.

## API

| Export                                   | What it does                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `createReporter(options)`                | A reporting session: `addResult()` each test, then `complete()` (see above)                 |
| `createRun(options)`                     | Creates one automated run (no cases) up front, a run CI shards share. Never rejects.        |
| `closeRun(options)`                      | Closes one run, such as a run shared by CI shards. Never rejects.                           |
| `resolveConfig(options, env)`            | The configuration a reporter would use, with its problems and warnings                      |
| `buildAutomationKey(identity, options)`  | The automation key v1 of a test                                                             |
| `toReportEntry(input, context)`          | One report entry from a `TestResultInput` of at most one case, inside the API limits        |
| `fanOutByCase(input)`                    | One `TestResultInput` per linked case ([several cases](#one-test-several-cases))            |
| `extractCaseIds`, `parseCaseIdList`, …   | Case ids in titles and lists ([case ids in titles](#case-ids-in-titles))                    |
| `detectCiSource(env)`                    | The CI provider, branch, commit and build URL                                               |
| `createClient(options)`                  | The HTTP client: `submitReport`, `createRun`, `closeRun`, and the result attachment methods |
| `createIdempotencyKey()`                 | A fresh `Idempotency-Key`. Reuse it on every attempt of one request.                        |
| `ProbaraApiError`, `ProbaraNetworkError` | What the client throws: an error response, or no response after the retries                 |
| `createConsoleLogger`, `redact`          | The default logger (`[probara] ` prefix) and the token redaction                            |
| Types                                    | Generated from the published OpenAPI: `ReportRequest`, `StagedAttachment`, and more         |
| Limits                                   | `MAX_RESULTS_PER_REPORT`, `MAX_ATTACHMENT_BYTES`, and the other contract limits             |

The client methods throw; `createReporter`, `createRun` and `closeRun` never do.

A disabled `resolveConfig` result (`{ ok: false, disabled: true }`) says why in `cause` (type
`DisabledCause`): `disabled` when `enabled: false` or `PROBARA_ENABLED` turned reporting off,
`not_configured` when neither a token nor a project is set. `reason` holds the same in words.

## Failure behavior

| Situation                                            | What happens                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Network error, timeout, 408, 429, 500, 502, 503, 504 | Retried up to `maxRetries` with exponential backoff and jitter. `Retry-After` wins (capped at 120 s). |
| A `201` whose body fails to arrive                   | Retried like a network error: the same idempotency key replays the stored response                    |
| 409 with `Retry-After` (in-flight duplicate)         | Retried the same way                                                                                  |
| Any other error, or retries run out                  | That report fails. Later reports are not sent (`notSent`), and the run is left open.                  |
| Invalid `addResult` input                            | Counted in `invalid` and logged. The other results are still sent.                                    |
| Logger throws                                        | Ignored                                                                                               |

`createRun` and `closeRun` retry the same way, under one idempotency key per call. A retried run
creation whose first response got lost is replayed, not created twice. Probara does not store a
5xx answer for a replay, though: when a run creation got a 5xx, its retry runs the creation again,
so a duplicate run is possible if the first attempt had created the run before failing. That is
why a failed `createRun` that may have reached Probara says to check the project's runs.

Sending more reports after a missing one would reorder outcomes or open a second run. That is why
core stops at the first failure. Nothing throws: `complete()` always resolves, and `status` is
`partial` (some reports were recorded) or `failed` (none were).

## CI detection

| Provider        | Detected by              | Branch, commit and build URL from                                                                |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| GitHub Actions  | `GITHUB_ACTIONS=true`    | `GITHUB_HEAD_REF` / `GITHUB_REF_NAME`, `GITHUB_SHA`, the run URL                                 |
| GitLab CI       | `GITLAB_CI=true`         | `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` / `CI_COMMIT_REF_NAME`, `CI_COMMIT_SHA`, `CI_PIPELINE_URL` |
| CircleCI        | `CIRCLECI=true`          | `CIRCLE_BRANCH`, `CIRCLE_SHA1`, `CIRCLE_BUILD_URL`                                               |
| Azure Pipelines | `TF_BUILD=true`          | the source branch, `BUILD_SOURCEVERSION`, the build results URL                                  |
| Jenkins         | `JENKINS_URL`            | `BRANCH_NAME` / `GIT_BRANCH`, `GIT_COMMIT`, `BUILD_URL`                                          |
| Bitbucket       | `BITBUCKET_BUILD_NUMBER` | `BITBUCKET_BRANCH`, `BITBUCKET_COMMIT`, the pipeline URL                                         |
| Buildkite       | `BUILDKITE=true`         | `BUILDKITE_BRANCH`, `BUILDKITE_COMMIT`, `BUILDKITE_BUILD_URL`                                    |

The first match wins. A tag build sends no branch (GitHub `GITHUB_REF_TYPE=tag`, GitLab
`CI_COMMIT_TAG` outside a merge request, Azure `refs/tags/`, Jenkins and Buildkite when the branch
is the tag). `PROBARA_BRANCH`, `PROBARA_COMMIT` and `PROBARA_BUILD_URL` override the
detected values. Invalid values are dropped, never sent. `detectCiSource(env)` exposes the same
detection.

## Security

- The token is only sent in the `Authorization` header. Every log line, error message and summary
  string is redacted against it, including server messages that echo it back.
- Config problems and warnings name the option or variable at fault. They never print its value.
- Keep `PROBARA_API_TOKEN` in your CI secret store, not in the repository. Use an app token from
  the **JUnit XML** card in **Integrations**: it can only report, it is not tied to a person, and
  you revoke it from the same card (and create a new one) when it may have leaked, or when someone
  who could read it leaves.

## License

[Apache License 2.0](./LICENSE).
