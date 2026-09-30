# @probara/playwright-reporter

A Playwright reporter that sends every test result of a run to [Probara](https://probara.net), with
its attachments. Built on [`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md).

Requirements: Node.js 22.12 or later and `@playwright/test` 1.42 or later.

## Quick path

1. Install it:

   ```bash
   npm i -D @probara/playwright-reporter
   ```

2. Register it next to your terminal reporter in `playwright.config.ts`:

   ```ts
   import { defineConfig } from '@playwright/test';

   export default defineConfig({
     reporter: [['list'], ['@probara/playwright-reporter']],
   });
   ```

3. Set `PROBARA_API_TOKEN` (an app token from the **JUnit XML** card in **Integrations**) and
   `PROBARA_PROJECT` (the project code, such as `SHOP`) in CI, and run `npx playwright test`.
   Without them the reporter stays off and quiet.

The reporter logs on stderr, in `[probara]` lines, and ends with the run link:
`[probara] Recorded 46 results (26 new cases, 0 unmatched) in R-12 (closed): <url>`.

## Configuration

Every option of `@probara/core` works under the same name, in `playwright.config` or as its
`PROBARA_*` variable ([the options](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#configuration)).
Precedence is options, then variables, then defaults:

```ts
reporter: [['list'], ['@probara/playwright-reporter', { projectId: 'SHOP', captureOutput: true }]],
```

The reporter adds one option:

| Option          | Variable                 | Default                                                                |
| --------------- | ------------------------ | ---------------------------------------------------------------------- |
| `captureOutput` | `PROBARA_CAPTURE_OUTPUT` | `false`. `true` attaches each attempt's `stdout.log` and `stderr.log`. |

## What is sent

- **One result per attempt**: a retried test sends each attempt, in order; Probara keeps the last
  outcome.
- **Statuses**: passed is `passed`; failed, timed out and interrupted are `failed`; `test.skip()`
  and `test.fixme()` are `skipped`. A `test.fail()` test that fails as expected is `passed`, and one
  that passes is `failed`. `statusMapping` and `statusFilter` apply on top.
- **Keys**: the same automation keys as `probara import junit` gives the Playwright JUnit reporter,
  so switching between them keeps every case linked: the file relative to Playwright's `rootDir`,
  the describe blocks, the title, and `[project=<name>]` for a named Playwright project.
- **Case links**: an annotation `{ type: 'probara_case', description: 'SHOP-12' }` (a comma list
  links several cases), or an id of the reported project in a title (`SHOP-12 logs in`), which is
  removed from the key. A test linked to several cases is sent once per case.
- **Errors**: every error of the attempt, message and stack, in the result notes.
- **Attachments**: every attachment of the attempt with a file or a body: screenshots, videos,
  traces, `testInfo.attach()` files, visual diffs and the error context.

## Sharded runs

Shards share one run: create it once, pass its ULID to every shard, close it at the end:

```bash
PROBARA_RUN_ULID=$(npx @probara/cli run create)   # before the shards
PROBARA_RUN_ULID=$PROBARA_RUN_ULID npx playwright test --shard=1/4   # every shard
PROBARA_RUN_ULID=$PROBARA_RUN_ULID npx @probara/cli run close        # after the last shard
```

With Playwright's blob reports instead, register the reporter only when merging: the shards write
`blob` reports, and one job sends them all, attachments included:

```bash
npx playwright merge-reports --reporter @probara/playwright-reporter ./all-blob-reports
```

## Failures

The reporter never throws into Playwright and never changes its exit code: a reporting failure is
logged on stderr, and the tests keep their outcome.

## License

[Apache License 2.0](./LICENSE).
