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
  links several cases), `probara.id()`, or an id of the reported project in a title
  (`SHOP-12 logs in`), which is removed from the key. Every source links: the annotations first
  (in order, `probara.id()` among them), then the title ids, each once. A test linked to several
  cases is sent once per case.
- **Errors**: every error of the attempt, message and stack, in the result notes. A skipped
  attempt with a reason (`test.skip(true, 'reason')`) has `Skipped: reason` in its notes.
- **Attachments**: every attachment of the attempt with a file or a body: screenshots, videos,
  traces, `testInfo.attach()` files, visual diffs and the error context. A file Playwright stored
  under a hashed name (`pixel-<sha1>.png`, or any file of a merged blob report) is named from its
  attachment: `pixel.png`, `trace.zip`.

## Test helpers

`probara` tells the reporter more about a test, from its body, a hook or a fixture:

```ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('pays with a card', async ({ page }) => {
  probara.id('SHOP-12').title('Pays with a saved card').suite(['Payments', 'Cards']);
  probara.tags('smoke').fields({ severity: 'critical' }).parameters({ user: 'admin' });
  await test.step(probara.step('Pay', 'The order is paid', 'card=visa'), async () => {
    await probara.attach({ name: 'receipt', body: '{"id":1}', contentType: 'application/json' });
  });
});
```

| Helper                                | What it does                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `id(id \| ids)`                       | Links existing cases, with the annotations and the title ids.                     |
| `title(text)`                         | Title of the case the report creates. Never changes the key.                      |
| `suite(title \| titles)`              | Suite path of the case the report creates. Never changes the key.                 |
| `comment(text)`                       | Written first in the notes, before the error.                                     |
| `ignore()`                            | This attempt is not reported.                                                     |
| `parameters(record)`                  | Parameters of the result, merged by name. Never part of the key.                  |
| `tags(...names)`                      | Tags of the case the report creates, accumulated.                                 |
| `fields(record)`                      | Fields of the case the report creates (system or custom by name), merged by name. |
| `attach({ name, path \| body, ... })` | Attaches a file (awaitable) to the attempt, or to the running `test.step`.        |
| `step(action, expected?, data?)`      | A `test.step` title that also declares a step of the case the report creates.     |

- Each helper applies to the running attempt: a retry starts empty. Call them in the test,
  `beforeEach`, `afterEach` or a test fixture. `title`, `suite` and `comment` keep their last call.
  A test skipped before it runs (`test.skip('title', ...)`) never calls them: link it with an
  annotation or a title id.
- `probara.step('Pay')` returns `Pay [probara:1]`: the short reference points at the declaration.
- A helper never throws into the test: a wrong argument, or a call while no test runs, is a
  `[probara]` warning on the test's stderr.
- `parameters`, `tags`, `fields` and `step` need a newer Probara API; until then the reporter
  keeps them and logs them at debug (`PROBARA_DEBUG=true`).
- Metadata travels as `_probara` attachments (`application/vnd.probara.metadata+json`), which the
  reporter reads and never uploads; Playwright's HTML report lists them with the attempt.

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
