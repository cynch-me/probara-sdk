# @probara/core

The base library every Probara adapter builds on. You create a reporter, hand it each finished
test, and call `complete()`. Core takes care of the rest:

- reading configuration from options and `PROBARA_*` variables,
- detecting the CI build,
- building the automation key,
- keeping every field inside the API limits,
- chunking, retries, and the final summary.

A reporting failure never throws into the test framework.

> **Not published yet.** `@probara/core` is not on npm. Until it is, use it from this workspace
> (`"@probara/core": "workspace:*"`).

## Quick path

1. Set `PROBARA_API_TOKEN` and `PROBARA_PROJECT` in CI. Without them the reporter stays off and
   quiet.
2. Call `createReporter()` when the run starts, `addResult()` for each test, and
   `await complete()` at the end.
3. Look for the log line `[probara] Recorded 120 results (3 new cases, 2 unmatched) in R-12 (closed): <url>`.

## Writing an adapter

Here is a minimal Playwright-style reporter. The official Playwright reporter is planned; this
sketch shows the contract.

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

| Field           | Required | Notes                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------- |
| `identity`      | yes      | `{ file?, titlePath, parameters? }`, which builds the automation key   |
| `status`        | yes      | `passed`, `failed`, `skipped` or `blocked`                             |
| `caseDisplayId` | no       | Explicit link such as `PRB-12`. The server treats it as authoritative. |
| `automationKey` | no       | Replaces the built key (see below)                                     |
| `title`         | no       | Title of a created case. Defaults to the last title segment.           |
| `suitePath`     | no       | Suites of a created case. Defaults to the file, then the describes.    |
| `durationMs`    | no       | Rounded, never negative                                                |
| `startedAt`     | no       | `Date`, ISO string or epoch ms, sent as `executedAt`                   |
| `error`         | no       | A string or `{ message?, stack? }`, written into the notes             |
| `notes`         | no       | Extra text, added after the error                                      |

### The summary

`complete()` resolves a `ReportSummary`:

| Field       | Meaning                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------ |
| `status`    | `disabled`, `empty`, `completed`, `partial` or `failed`                                    |
| `run`       | `{ ulid, displayId, state, url }` once a report was recorded                               |
| `recorded`  | Results recorded in the run                                                                |
| `created`   | Cases the reports created                                                                  |
| `unmatched` | `{ reason, automationKey?, caseDisplayId?, title? }` for each result that recorded nothing |
| `invalid`   | Inputs `addResult` could not convert (adapter bugs). These are never sent.                 |
| `notSent`   | Results that did not reach Probara: the failed report and every one after it               |
| `errors`    | `{ message, code?, status? }` for config problems and failed reports                       |

## Configuration

Precedence is **options > environment > defaults**. An option set to `undefined` never overrides
the environment. Booleans accept `true/1/yes/on` and `false/0/no/off`.

| Option                   | Variable                                                | Default                                                              |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `enabled`                | `PROBARA_ENABLED`                                       | on (`false` turns reporting off)                                     |
| `apiToken`               | `PROBARA_API_TOKEN`                                     | none (required)                                                      |
| `projectId`              | `PROBARA_PROJECT`                                       | none (required). The project code, such as `SHOP`.                   |
| `baseUrl`                | `PROBARA_BASE_URL`                                      | `https://app.probara.net`                                            |
| `run.ulid`               | `PROBARA_RUN_ULID`                                      | none, so core creates a run                                          |
| `run.name`               | `PROBARA_RUN_NAME`                                      | the CI build name (`CI #42`), else `Automated run <date> <time> UTC` |
| `run.environmentId`      | `PROBARA_ENVIRONMENT_ID`                                | none                                                                 |
| `run.milestoneId`        | `PROBARA_MILESTONE_ID`                                  | none                                                                 |
| `run.configurationUlids` | `PROBARA_CONFIGURATION_ULIDS`                           | none (comma-separated)                                               |
| `run.tags`               | `PROBARA_RUN_TAGS`                                      | none (comma-separated)                                               |
| `source`                 | `PROBARA_BRANCH`, `PROBARA_COMMIT`, `PROBARA_BUILD_URL` | detected from CI. `false` sends none.                                |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES`                          | `true`                                                               |
| `suiteUlid`              | `PROBARA_SUITE_ULID`                                    | the project root                                                     |
| `closeRun`               | `PROBARA_CLOSE_RUN`                                     | `true` for a created run, `false` for a reused one                   |
| `debug`                  | `PROBARA_DEBUG`                                         | `false`                                                              |
| `rootDir`                | none                                                    | `process.cwd()`. File paths in keys are relative to it.              |
| `clientName`             | none                                                    | none. Sent first in the User-Agent.                                  |
| `chunkSize`              | none                                                    | `500` (1..500)                                                       |
| `timeoutMs`              | none                                                    | `30000` per attempt                                                  |
| `maxRetries`             | none                                                    | `4`                                                                  |

The options for creating a run (`run.name`, `run.environmentId`, and the others) are ignored, with
a warning, when `run.ulid` is set.

What happens with each setup:

| Setup                                        | Result                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| No token and no project, or `enabled: false` | Disabled. Nothing is sent, and core logs at debug only.                        |
| Only one of them, or an invalid value        | Reporting is off. Each problem is logged at error, and the status is `failed`. |
| Both valid                                   | Enabled                                                                        |

`createReporter` also accepts test seams: `logger`, `env`, `fetch`, `sleep`, `random` and `now`.

## The automation key (v1)

The key links a test to its Probara case. Every adapter must build the same key for the same test,
so the algorithm is **frozen**. Golden vectors in `src/automation-key.test.ts` pin it: changing
the algorithm would unlink every case already reported.

1. `file`: an absolute path is made relative to `rootDir`, `\` becomes `/`, repeated `/` collapse,
   and a leading `./` is removed.
2. Each `titlePath` segment is NFC-normalized, control characters and whitespace runs become one
   space, and the segment is trimmed. Empty segments are dropped.
3. `parameters` are sorted by name and appended to the last segment:
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

## What core normalizes

A single field outside the contract makes the API reject the whole report with 422. Core keeps
every entry inside the limits, so an adapter never causes that:

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
- Each report gets its own `Idempotency-Key`. Retries reuse it, so a retried report is replayed,
  never recorded twice.

Sharded CI: create one run first (in the Probara app or through its API), share its ULID with
every shard, and close it once at the end:

```bash
# Every shard
PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 <your test command> --shard=1/4
```

With `PROBARA_RUN_ULID` set, `closeRun` defaults to `false`. No shard closes a run that other
shards are still writing to. Close the run after the last shard, in the app or through the API.
Core has no close-only call yet: a reporter with no results sends nothing, so it cannot close
a run.

## Failure behavior

| Situation                                            | What happens                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Network error, timeout, 408, 429, 500, 502, 503, 504 | Retried up to `maxRetries` with exponential backoff and jitter. `Retry-After` wins (capped at 120 s). |
| 409 with `Retry-After` (in-flight duplicate)         | Retried the same way                                                                                  |
| Any other error, or retries run out                  | That report fails. Later reports are not sent (`notSent`), and the run is left open.                  |
| Invalid `addResult` input                            | Counted in `invalid` and logged. The other results are still sent.                                    |
| Logger throws                                        | Ignored                                                                                               |

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

The first match wins. `PROBARA_BRANCH`, `PROBARA_COMMIT` and `PROBARA_BUILD_URL` override the
detected values. Invalid values are dropped, never sent. `detectCiSource(env)` exposes the same
detection.

## Security

- The token is only sent in the `Authorization` header. Every log line, error message and summary
  string is redacted against it, including server messages that echo it back.
- Config problems and warnings name the option or variable at fault. They never print its value.
- Keep `PROBARA_API_TOKEN` in your CI secret store, not in the repository.
