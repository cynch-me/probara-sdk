# Migrating from Qase

Moving from `playwright-qase-reporter` is mostly renaming: the reporter registration, the
settings, and the `qase.*` calls. This page maps each one, then lists what works differently and
what is not ported, with the reasons.

## Quick path

1. `npm uninstall playwright-qase-reporter && npm i -D @probara/playwright-reporter`.
2. In `playwright.config`, replace `['playwright-qase-reporter', {...}]` with
   `['@probara/playwright-reporter', {...}]`, translating the options (below). Delete
   `qase.config.json`: the reporter reads only its options and `PROBARA_*` variables.
3. Replace `QASE_*` variables with `PROBARA_*` ones in CI: at least `PROBARA_API_TOKEN` (an app
   token from the **Playwright** card, [get a token](configuration.md#get-a-token)) and
   `PROBARA_PROJECT`.
4. Replace `import { qase } from 'playwright-qase-reporter'` with
   `import { probara } from '@probara/playwright-reporter'`, and translate the calls (below). Case
   ids become Probara display ids (`SHOP-12`), not numbers.

Before:

<!-- not-run: Qase's reporter -->

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    [
      'playwright-qase-reporter',
      {
        mode: 'testops',
        testops: {
          project: 'SHOP',
          run: { title: 'Nightly', complete: true, tags: ['nightly'] },
          uploadAttachments: true,
        },
        captureLogs: true,
      },
    ],
  ],
});
```

After:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    [
      '@probara/playwright-reporter',
      {
        projectId: 'SHOP',
        run: { name: 'Nightly', tags: ['nightly'] },
        captureOutput: true,
      },
    ],
  ],
});
```

## Options and variables

| Qase option (`QASE_*` variable)                       | Probara option (`PROBARA_*` variable)                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `mode: 'testops'` (`QASE_MODE`)                       | On whenever a token and a project are set                                          |
| `mode: 'off'`                                         | `enabled: false` (`PROBARA_ENABLED=false`), or no token                            |
| `mode: 'report'`, `fallback`                          | `resultsFile` (`PROBARA_RESULTS_FILE`) ([results file](results-file.md))           |
| `mode: 'testops_multi'`, `testops_multi.*`            | `projectId` plus `projects` and `run.ulids` ([several projects](multi-project.md)) |
| `debug` (`QASE_DEBUG`)                                | `debug` (`PROBARA_DEBUG`)                                                          |
| `environment` (`QASE_ENVIRONMENT`), a slug            | `run.environment` (`PROBARA_ENVIRONMENT`), a name, created when missing            |
| `rootSuite` (`QASE_ROOT_SUITE`)                       | `suiteUlid` (`PROBARA_SUITE_ULID`): an existing suite, by ULID                     |
| `captureLogs` (`QASE_CAPTURE_LOGS`)                   | `captureOutput` (`PROBARA_CAPTURE_OUTPUT`)                                         |
| `statusMapping` (`QASE_STATUS_MAPPING`)               | `statusMapping` (`PROBARA_STATUS_MAPPING`), without `invalid`                      |
| `logging.console`, `logging.file`                     | Logs go to stderr; the `logger` option for code                                    |
| `testops.api.token` (`QASE_TESTOPS_API_TOKEN`)        | `PROBARA_API_TOKEN` (`apiToken` for code)                                          |
| `testops.api.host` (`QASE_TESTOPS_API_HOST`)          | `baseUrl` (`PROBARA_BASE_URL`), a full URL                                         |
| `testops.api.timeout` (seconds)                       | `timeoutMs` (milliseconds)                                                         |
| `testops.api.retries`, `testops.api.retryBackoff`     | `maxRetries`; the backoff is fixed ([network](network.md))                         |
| `testops.project` (`QASE_TESTOPS_PROJECT`)            | `projectId` (`PROBARA_PROJECT`)                                                    |
| `testops.uploadAttachments`                           | `uploadAttachments` (`PROBARA_UPLOAD_ATTACHMENTS`)                                 |
| `testops.attachments.concurrency`, `.timeout`         | `attachmentConcurrency`; uploads get at least 120 s                                |
| `testops.run.id` (`QASE_TESTOPS_RUN_ID`)              | `run.ulid` (`PROBARA_RUN_ULID`)                                                    |
| `testops.run.title`, `.description`, `.tags`          | `run.name`, `run.description`, `run.tags` (`PROBARA_RUN_*`)                        |
| `testops.run.complete`                                | `closeRun` (`PROBARA_CLOSE_RUN`); a created run is closed by default               |
| `testops.plan.id` (`QASE_TESTOPS_PLAN_ID`)            | `run.plan` (`PROBARA_PLAN`): the plan's display id or name                         |
| `testops.configurations.values` (`group=value`)       | `run.configurations` (`PROBARA_CONFIGURATIONS=Group=Name`)                         |
| `testops.statusFilter` (`QASE_TESTOPS_STATUS_FILTER`) | `statusFilter` (`PROBARA_STATUS_FILTER`)                                           |
| `testops.batch.size`                                  | `chunkSize` (1 to 500)                                                             |
| `framework.browser.addAsParameter`                    | Nothing to set: the Playwright project is part of the key                          |

Qase settings without a counterpart are in [not ported](#not-ported).

## The `qase.*` calls

| Qase                                                                                  | Probara                                                                                        |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `test(qase(12, 'pays'), ...)`                                                         | `test('SHOP-12 pays', ...)`, or an annotation                                                  |
| `test(qase([12, 13], 'pays'), ...)`                                                   | `test('pays', { annotation: { type: 'probara_case', description: 'SHOP-12, SHOP-13' } }, ...)` |
| `{ type: 'QaseID', description: '12' }` annotation                                    | `{ type: 'probara_case', description: 'SHOP-12' }`                                             |
| `(Qase ID: 12)` in a title                                                            | `SHOP-12` in a title                                                                           |
| `qase.id(12)`                                                                         | `probara.id('SHOP-12')`                                                                        |
| `qase.title('...')`                                                                   | `probara.title('...')`                                                                         |
| `qase.suite('Payments\tCards')`, a `QaseSuite` annotation                             | `probara.suite(['Payments', 'Cards'])`                                                         |
| `qase.fields({ severity: 'critical' })`                                               | `probara.fields({ severity: 'critical' })`                                                     |
| `qase.tags('smoke')`                                                                  | `probara.tags('smoke')`                                                                        |
| `qase.comment('...')`                                                                 | `probara.comment('...')`                                                                       |
| `qase.ignore()`                                                                       | `probara.ignore()`                                                                             |
| `qase.parameters({...})`, `qase.groupParameters({...})`                               | `probara.parameters({...})`                                                                    |
| `qase.attach({ paths: [a, b] })`                                                      | `await probara.attach({ name, path })`, once per file                                          |
| `qase.attach({ name, content, contentType })`                                         | `await probara.attach({ name, body, contentType })`                                            |
| `qase.step('Pay', 'Paid', 'card=visa')`                                               | `probara.step('Pay', 'Paid', 'card=visa')`                                                     |
| `qase.projects({ WEB: [3] })`, `qase.projectsTitle(...)`, a `QaseProjects` annotation | `WEB-3` as a case id, with `projects: ['WEB']`                                                 |

Before:

<!-- not-run: Qase's reporter -->

```ts
// tests/checkout.spec.ts
import { test } from '@playwright/test';
import { qase } from 'playwright-qase-reporter';

test(qase(12, 'pays with a card'), async () => {
  qase.fields({ severity: 'critical' }).tags('smoke');
  await test.step(qase.step('Pay', 'The order is paid'), async () => {});
  qase.attach({ name: 'order.json', content: '{"id":1042}', contentType: 'application/json' });
});
```

After:

<!-- project: after -->

```ts
// tests/checkout.spec.ts
import { test } from '@playwright/test';
import { probara } from '@probara/playwright-reporter';

test('SHOP-12 pays with a card', async () => {
  probara.fields({ severity: 'critical' }).tags('smoke');
  await test.step(probara.step('Pay', 'The order is paid'), async () => {});
  await probara.attach({
    name: 'order.json',
    body: '{"id":1042}',
    contentType: 'application/json',
  });
});
```

<!-- sent: after -->

```json
[
  {
    "caseDisplayId": "SHOP-12",
    "automationKey": "checkout.spec.ts > pays with a card",
    "steps": [{ "action": "Pay", "expected": "The order is paid" }],
    "case": { "tags": ["smoke"], "fields": { "severity": "critical" } }
  }
]
```

## What is different, and why

| Topic                 | Qase                                                                                                                  | Probara                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Precedence            | Its code lets variables win over `qase.config.json`, which wins over the reporter options (its docs say the opposite) | Options in `playwright.config`, then `PROBARA_*` variables, then defaults: what the config says is what runs                 |
| Config file           | `qase.config.json` or `.qaserc`                                                                                       | None: a config file holding a token could be committed. Options live in `playwright.config`                                  |
| Case ids              | Numbers, per project mapping                                                                                          | Display ids (`SHOP-12`): the project code routes each id to its project                                                      |
| `test.fail()`         | Ignored: an expected failure is sent as failed (or invalid), an unexpected pass as passed                             | Playwright's verdict: an expected failure passes, an unexpected pass fails ([statuses](statuses.md))                         |
| Statuses              | `invalid` for a failure whose error does not look like an assertion (a guess from the message)                        | `passed`, `failed`, `skipped`; `blocked` only through `statusMapping`. No guessing from error text                           |
| Interrupted attempts  | `failed` (its docs say skipped)                                                                                       | `failed`                                                                                                                     |
| Case fields           | Sent with every result                                                                                                | Only when the report creates the case: an existing case keeps what people wrote ([metadata](metadata.md#created-cases-only)) |
| `fields()` calls      | The last call replaces the others                                                                                     | Merged by name                                                                                                               |
| Closing the run       | Only with `run.complete: true`                                                                                        | A run the reporter creates is closed at the end; a reused one stays open                                                     |
| Shards                | Each shard makes its own run unless it gets a run id                                                                  | `merge-reports`, or `probara run create` and `run close` ([sharding](ci/sharding.md))                                        |
| When reporting fails  | `fallback` to a local report                                                                                          | A results file, sent later by `probara import results` into the same runs                                                    |
| Strings in `attach()` | A string that looks like base64 is decoded                                                                            | A string is sent as it is; pass a `Buffer` for binary content                                                                |
| Error of a result     | The error context text in a field of its own                                                                          | Every error in the notes; `error-context.md` as a file                                                                       |
| Flaky attempts        | `framework.markAsFlaky` flags a passing retry                                                                         | Every attempt is a result; no flag ([retries](retries.md))                                                                   |

## Not ported

| Qase feature                                  | Why                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Public report link (`showPublicReportLink`)   | A public link to test results is a sharing decision for the Probara app, not something a CI job should turn on                   |
| Automatic defects (`testops.defect`)          | Filing a defect for every failure floods the defect list; report defects from the result in Probara                              |
| Network profiler (`profilers: ['network']`)   | It records the test process's HTTP calls as steps, which is noise for browser tests; attach what matters with `probara.attach()` |
| Jira link on runs (`run.externalLink`)        | Probara links Jira issues to cases and defects, where traceability lives                                                         |
| A separate error field (`error_context`)      | Errors go in the notes, and the error context is attached as a file, so nothing is cut at a field's size                         |
| `qase.mute()`                                 | Documented by Qase, but it does not exist in its reporter                                                                        |
| Creating configurations (`createIfNotExists`) | Configurations are part of a project's planning; an unknown one is refused, so a typo never creates a new one                    |
| `framework.markAsFlaky`                       | Every attempt is a result: the history shows flakiness without a flag                                                            |
| Logging to a file (`logging.file`)            | Logs go to stderr, where CI keeps them; redirect stderr to keep a file                                                           |

## See also

- [Configuration](configuration.md): every option.
- [Linking](linking.md): case ids and automation keys.
