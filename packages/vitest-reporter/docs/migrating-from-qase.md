# Migrating from Qase

Moving from `vitest-qase-reporter` is mostly renaming: the reporter entry, its settings, and the
`ctx.qase` calls, which become `probara.*` calls without a `withQase()` wrapper. This page maps
each one as Qase's code (version 1.5.1) has it, which differs from Qase's documentation in places
([documented, but not in the code](#documented-but-not-in-the-code)), then lists what works
differently and what is not ported, with the reasons.

## Quick path

1. `npm uninstall vitest-qase-reporter && npm i -D @probara/vitest-reporter`.
2. In `vitest.config.mts`, replace `['vitest-qase-reporter', {...}]` with
   `['@probara/vitest-reporter', {...}]`, translating the options (below). Delete
   `qase.config.json` and `.qaserc`: the reporter reads only its options and `PROBARA_*`
   variables. Take `vitest-qase-reporter/setup` out of `setupFiles` if you added it: the reporter
   adds its own setup file.
3. Replace `QASE_*` variables with `PROBARA_*` ones in CI: at least `PROBARA_API_TOKEN` (an app
   token from the **Vitest** card, [get a token](configuration.md#get-a-token)) and
   `PROBARA_PROJECT`.
4. Import `probara` from `@probara/vitest-reporter`, turn each `withQase(async ({ qase }) => {...})`
   back into a plain test function, and translate the calls ([below](#the-ctxqase-calls)). Case ids
   become Probara display ids (`SHOP-12`), not numbers.

Before:

<!-- not-run: Qase's reporter -->

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: [
      'default',
      [
        'vitest-qase-reporter',
        {
          mode: 'testops',
          testops: {
            project: 'SHOP',
            run: { title: 'Nightly', complete: true, tags: ['nightly'] },
            uploadAttachments: true,
          },
        },
      ],
    ],
  },
});
```

After:

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: [
      'default',
      [
        '@probara/vitest-reporter',
        { projectId: 'SHOP', run: { name: 'Nightly', tags: ['nightly'] }, captureOutput: true },
      ],
    ],
  },
});
```

`captureOutput` is optional: it attaches each attempt's console output, which Qase's `captureLogs`
never did for Vitest ([captured output](output.md)). The run is closed at the end without
`complete: true`, and `uploadAttachments` is on by default.

## Options and variables

| Qase option (`QASE_*` variable)                                                       | Probara option (`PROBARA_*` variable)                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `mode: 'testops'` (`QASE_MODE`)                                                       | On whenever a token and a project are set                                                              |
| `mode: 'off'`                                                                         | `enabled: false` (`PROBARA_ENABLED=false`), or no token                                                |
| `mode: 'report'`, `fallback` (`QASE_FALLBACK`)                                        | `resultsFile` (`PROBARA_RESULTS_FILE`) ([results file](results-file.md))                               |
| `report.connections.local.path`, `.format` (`QASE_REPORT_CONNECTION_PATH`, `_FORMAT`) | `resultsFile`, the path of a JSON file                                                                 |
| `mode: 'testops_multi'`, `testops_multi.*`                                            | `projectId` plus `projects` and `run.ulids` ([several projects](projects.md#several-probara-projects)) |
| `debug` (`QASE_DEBUG`)                                                                | `debug` (`PROBARA_DEBUG`)                                                                              |
| `environment` (`QASE_ENVIRONMENT`), a slug, ignored when not found                    | `run.environment` (`PROBARA_ENVIRONMENT`), a name, created when missing                                |
| `rootSuite` (`QASE_ROOT_SUITE`)                                                       | `suiteUlid` (`PROBARA_SUITE_ULID`): an existing suite, by ULID                                         |
| `captureLogs` (`QASE_CAPTURE_LOGS`): ignored by Qase's Vitest reporter                | `captureOutput` (`PROBARA_CAPTURE_OUTPUT`)                                                             |
| `statusMapping` (`QASE_STATUS_MAPPING`)                                               | `statusMapping` (`PROBARA_STATUS_MAPPING`), without `invalid` and `disabled`                           |
| `logging.console`, `logging.file` (`QASE_LOGGING_CONSOLE`, `QASE_LOGGING_FILE`)       | Logs go to stderr; the `logger` option for code                                                        |
| `testops.api.token` (`QASE_TESTOPS_API_TOKEN`)                                        | `PROBARA_API_TOKEN` (`apiToken` for code)                                                              |
| `testops.api.host` (`QASE_TESTOPS_API_HOST`)                                          | `baseUrl` (`PROBARA_BASE_URL`), a full URL                                                             |
| `testops.api.timeout` (`QASE_TESTOPS_API_TIMEOUT`), in seconds                        | `timeoutMs`, in milliseconds, for every request                                                        |
| `testops.api.retries`, `testops.api.retryBackoff`                                     | `maxRetries`, for every request; the backoff is fixed ([network](network.md#retries-and-backoff))      |
| `testops.project` (`QASE_TESTOPS_PROJECT`)                                            | `projectId` (`PROBARA_PROJECT`)                                                                        |
| `testops.uploadAttachments` (`QASE_TESTOPS_UPLOAD_ATTACHMENTS`)                       | `uploadAttachments` (`PROBARA_UPLOAD_ATTACHMENTS`)                                                     |
| `testops.attachments.concurrency`, `.timeout`                                         | `attachmentConcurrency`; uploads get at least 120 s ([network](network.md#timeouts))                   |
| `testops.run.id` (`QASE_TESTOPS_RUN_ID`)                                              | `run.ulid` (`PROBARA_RUN_ULID`)                                                                        |
| `testops.run.title`, `.description`, `.tags`                                          | `run.name`, `run.description`, `run.tags` (`PROBARA_RUN_*`)                                            |
| `testops.run.complete` (`QASE_TESTOPS_RUN_COMPLETE`)                                  | `closeRun` (`PROBARA_CLOSE_RUN`); a created run is closed by default                                   |
| `testops.plan.id` (`QASE_TESTOPS_PLAN_ID`)                                            | `run.plan` (`PROBARA_PLAN`): the plan's display id or name                                             |
| `testops.configurations.values` (`group=value`)                                       | `run.configurations` (`PROBARA_CONFIGURATIONS=Group=Name`)                                             |
| `testops.statusFilter` (`QASE_TESTOPS_STATUS_FILTER`)                                 | `statusFilter` (`PROBARA_STATUS_FILTER`)                                                               |
| `testops.batch.size` (`QASE_TESTOPS_BATCH_SIZE`)                                      | `chunkSize` (1 to 500)                                                                                 |
| (none)                                                                                | `run.milestone` (`PROBARA_MILESTONE`): Qase's reporter has no milestone                                |

Qase settings without a counterpart are in [not ported](#not-ported). Every Probara option is on
the [configuration](configuration.md) page.

## The `ctx.qase` calls

| Qase                                                                | Probara                                                                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `test(addQaseId('pays', [12]), ...)`, `(Qase ID: 12)` in a title    | `test('SHOP-12 pays', ...)`: an id in the title or a `describe` ([linking](linking.md))                                       |
| `addQaseId('pays', [12, 13])`                                       | `'SHOP-12 SHOP-13 pays'`, or `probara.id(['SHOP-12', 'SHOP-13'])`                                                             |
| `addQaseProjects('pays', { WEB: [3] })`, `(Qase WEB: 3)` in a title | `WEB-3` in the title, with `projects: ['WEB']` ([several projects](projects.md#several-probara-projects))                     |
| `withQase(async ({ qase }) => {...})`                               | The test function itself: `probara` finds the running test on its own                                                         |
| `await qase.title('...')`                                           | `probara.title('...')`                                                                                                        |
| `await qase.suite('Payments - Cards')`                              | `probara.suite(['Payments', 'Cards'])`                                                                                        |
| `await qase.fields({ severity: 'critical' })`                       | `probara.fields({ severity: 'critical' })`                                                                                    |
| `await qase.tags('smoke', 'checkout')`                              | `probara.tags('smoke', 'checkout')`                                                                                           |
| `await qase.comment('...')`                                         | `probara.comment('...')`                                                                                                      |
| `await qase.parameters({...})`, `await qase.groupParameters({...})` | `probara.parameters({...})`                                                                                                   |
| `await qase.step('Pay', fn, 'Paid', 'card=visa')`                   | `await probara.step('Pay', fn, { expected: 'Paid', data: 'card=visa' })`                                                      |
| `await qase.attach({ paths: [a, b] })`                              | `await probara.attach({ name, path })`, once per file                                                                         |
| `await qase.attach({ name, content, type })`                        | `await probara.attach({ name, body, contentType })`                                                                           |
| `await qase.annotate(message, options)`                             | `await context.annotate(message, options)`: Vitest's own; its file is sent ([attachments](attachments.md#vitest-annotations)) |
| (none: Qase's Vitest reporter has no `ignore`)                      | `probara.ignore()`                                                                                                            |
| (none)                                                              | `probara.link()` and `probara.issue()` ([links](links.md))                                                                    |

Remove the `(Qase ID: 12)` markers from the titles: the reporter reads them as text, so they would
stay in the automation key.

Before:

<!-- not-run: Qase's reporter -->

```ts
// tests/checkout.test.ts
import { test } from 'vitest';
import { addQaseId, withQase } from 'vitest-qase-reporter/vitest';

test(
  addQaseId('pays with a card', [12]),
  withQase(async ({ qase }) => {
    await qase.fields({ severity: 'critical' });
    await qase.tags('smoke');
    await qase.step('Pay', async () => {}, 'The order is paid');
    await qase.attach({ name: 'order.json', content: '{"id":1042}', type: 'application/json' });
  }),
);
```

After:

<!-- project: after -->

```ts
// tests/checkout.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('SHOP-12 pays with a card', async () => {
  probara.fields({ severity: 'critical' }).tags('smoke');
  await probara.step('Pay', async () => {}, { expected: 'The order is paid' });
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
    "automationKey": "tests/checkout.test.ts > pays with a card",
    "status": "passed",
    "steps": [{ "action": "Pay", "expected": "The order is paid", "status": "passed" }],
    "case": {
      "tags": ["smoke"],
      "fields": { "severity": "critical" },
      "steps": [{ "action": "Pay", "expected": "The order is paid" }]
    }
  }
]
```

<!-- files: after -->

```text
order.json application/json
```

The id leaves the title and the key: adding or removing it never changes which case the test
matches ([automation keys](linking.md#automation-keys)).

## Documented, but not in the code

Qase's README and guides show calls and settings that version 1.5.1 does not have, or has with
another behavior. Code copied from them fails or does something else:

| Qase's documentation                                                                                             | Qase's code (1.5.1)                                                       | With Probara                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `test(qase(12, 'pays'), ...)`, with `qase` imported from `vitest-qase-reporter` or `vitest-qase-reporter/vitest` | No `qase` is exported: only `withQase`, `addQaseId` and `addQaseProjects` | `test('SHOP-12 pays', ...)`                                                          |
| `qase.title()`, `qase.fields()`, `qase.suite()` on that import, in any test                                      | Only `ctx.qase`, in a function `withQase()` wraps                         | `probara.title()`, `probara.fields()`, `probara.suite()`, in any test                |
| `qase.ignore()`                                                                                                  | Not in the code                                                           | `probara.ignore()`                                                                   |
| `qase.mute()`                                                                                                    | Not in the code                                                           | Not ported ([below](#not-ported))                                                    |
| `setupFiles: ['vitest-qase-reporter/setup']`, for the network profiler                                           | Not exported by the package: Vitest cannot load it                        | Nothing to add: the reporter adds its own setup file                                 |
| `qase.suite('Payments\tCards')`, a tab between suites                                                            | Split only on a dash with a space on each side (`'Payments - Cards'`)     | `probara.suite(['Payments', 'Cards'])`                                               |
| Steps nested in steps                                                                                            | A step that holds steps is lost; only the inner ones are kept             | Nested as they ran ([steps](steps.md))                                               |
| An attachment of a step                                                                                          | Always the test's                                                         | `probara.attach()` inside a step ([files of a step](attachments.md#files-of-a-step)) |
| The reporter's options win over `QASE_*` variables, which win over `qase.config.json`                            | Variables win over the file, which wins over the options                  | Options, then variables ([precedence](configuration.md#sources-and-precedence))      |
| `testops.run.complete` is `true` by default                                                                      | Unset leaves the run open                                                 | A created run is closed by default ([closing](runs.md#closing))                      |
| `report.connection.*`                                                                                            | `report.connections.*`                                                    | `resultsFile`                                                                        |
| Watch mode reports when you exit or run every test again                                                         | Each re-run creates a new run, unless `run.id` is set                     | One run for the whole session ([watch mode](watch.md))                               |
| `api.token` per project of `testops_multi`                                                                       | One token for every project                                               | One app token for every project of the organization                                  |

## What is different, and why

| Topic                               | Qase                                                                                                     | Probara                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Precedence                          | Variables win over `qase.config.json`, which wins over the reporter options                              | Options in the Vitest config, then `PROBARA_*` variables, then defaults: what the config says is what runs                                                                         |
| Config file                         | `qase.config.json` or `.qaserc`                                                                          | None: a config file holding a token could be committed. Options live in the Vitest config                                                                                          |
| Case ids                            | Numbers, in the test's own title only                                                                    | Display ids (`SHOP-12`) in the title or any `describe`: the project code routes each id to its project                                                                             |
| The helpers                         | `ctx.qase`, inside `withQase()`, until the test body ends: Vitest refuses its annotations in `afterEach` | `probara`, imported once, works in the body, `beforeEach`, `afterEach`, `onTestFinished` and the functions they call ([where to call them](metadata.md#where-to-call-the-helpers)) |
| Steps                               | Flat; the expected result and data are encoded into the step name; no duration                           | Nested as they ran, each with its status, duration and error; the outermost become a new case's steps ([steps](steps.md))                                                          |
| Statuses                            | `invalid` for a failure whose error does not look like an assertion (a guess from the message)           | `passed`, `failed`, `skipped`; `blocked` only through `statusMapping`. No guessing from error text ([statuses](statuses.md))                                                       |
| Errors                              | The first error's message, which `comment()` replaces; every stack in a field of its own                 | Every error of the attempt in the notes, `expect.soft` failures included; a comment comes first and hides none                                                                     |
| `fields()` and `parameters()` calls | The last call replaces the others                                                                        | Merged by name                                                                                                                                                                     |
| Case fields                         | Sent with every result                                                                                   | Only when the report creates the case: an existing case keeps what people wrote ([created cases only](metadata.md#created-cases-only))                                             |
| Retries                             | The final attempt only                                                                                   | Every attempt is a result, with no flaky flag: the case's history shows the flakiness ([retries](retries.md))                                                                      |
| Closing the run                     | Only with `run.complete: true`; unset leaves it open                                                     | A run the reporter creates is closed at the end, once everything was sent; a reused one stays open ([closing](runs.md#closing))                                                    |
| Shards                              | Each shard makes its own run unless it gets a run id; closing a shared run is left to another step       | One run: `vitest --merge-reports` over the shards' blobs, or `probara run create` with `PROBARA_RUN_ULID` ([an existing run](runs.md#an-existing-run))                             |
| When reporting fails                | `fallback` to a local report                                                                             | A results file, sent later by `probara import results` into the same runs ([results file](results-file.md))                                                                        |
| Strings in `attach()`               | A string that looks like base64 is decoded (`'Hello'` uploads garbage)                                   | A string is sent as it is; pass a `Buffer` or a `Uint8Array` for binary content ([attachments](attachments.md#probaraattach))                                                      |
| `attach({ paths })`                 | A list of paths; the content type is `type`, not `contentType`                                           | One file per call, `path` or `body`, and `contentType`                                                                                                                             |

## Not ported

| Qase feature                                                                       | Why                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public report link (`showPublicReportLink`)                                        | A public link to test results is a sharing decision for the Probara app, not something a CI job should turn on                                                                                                                          |
| Automatic defects (`testops.defect`)                                               | Filing a defect for every failure floods the defect list; report defects from the result in Probara                                                                                                                                     |
| Network profiler (`profilers: ['network']`, `networkProfiler`)                     | Its steps are noise, up to the 200 steps of a result, and cannot be told apart when tests run in parallel; attach what matters with `probara.attach()` ([network](network.md#not-supported-a-network-profiler))                         |
| Jira link on runs (`run.externalLink`)                                             | Probara links Jira issues to cases and defects, where traceability lives; `probara.issue()` links a result to an issue                                                                                                                  |
| `qase.mute()`                                                                      | Documented by Qase, but not in its code; triage lives in Probara, on the results                                                                                                                                                        |
| Creating configurations (`createIfNotExists`)                                      | Configurations are part of a project's planning; an unknown one is refused, so a typo never creates a new one                                                                                                                           |
| The `invalid` status                                                               | It is a guess from the error text; Probara keeps four statuses and the whole error in the notes                                                                                                                                         |
| Logging to a file (`logging.file`)                                                 | Logs go to stderr, where CI keeps them; redirect stderr to keep a file                                                                                                                                                                  |
| Per-project plan and environment (`testops_multi.projects[].plan`, `.environment`) | Planning entities belong to one project, where an unknown name would refuse the report: create that project's run first with `probara run create` and pass it in `run.ulids` ([several projects](projects.md#several-probara-projects)) |
| A config file (`qase.config.json`, `.qaserc`)                                      | A file holding a token could be committed: the token stays in the environment, the options in the Vitest config                                                                                                                         |

## See also

- [Configuration](configuration.md): every option.
- [Metadata](metadata.md) and [steps](steps.md): the helpers in detail.
- [Linking](linking.md): case ids and automation keys.
- [Coming from other tools](coming-from-other-tools.md): Allure, ReportPortal and TestRail, and
  everything that is not supported.
