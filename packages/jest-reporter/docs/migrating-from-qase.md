# Migrating from Qase

Moving from `jest-qase-reporter` is mostly renaming: the reporter entry, its settings and the
`qase.*` calls. One thing changes for the better on the way: the `probara.*` helpers work in every
Jest worker, in `jsdom` and in watch mode, where Qase's only work in band. This page maps each
setting and call, then lists what works differently and what is not ported, with the reasons.

## Quick path

1. `npm uninstall jest-qase-reporter && npm i -D @probara/jest-reporter`.
2. In the Jest config, replace `['jest-qase-reporter', {...}]` with
   `['@probara/jest-reporter', {...}]`, translating the options (below). Delete `qase.config.json`
   and `.qaserc`: the reporter reads only its options and `PROBARA_*` variables.
3. Replace `QASE_*` variables with `PROBARA_*` ones in CI: at least `PROBARA_API_TOKEN` (an app
   token from the **Jest** card, [get a token](configuration.md#get-a-token)) and
   `PROBARA_PROJECT`.
4. Replace `require('jest-qase-reporter/jest')` with `require('@probara/jest-reporter')`, and
   translate the calls (below). Case ids become Probara display ids (`SHOP-12`), not numbers.
5. Remove `--runInBand` if you added it only for Qase's helpers: Probara's need nothing.

Before:

<!-- not-run: Qase's reporter -->

```js
// jest.config.js
module.exports = {
  reporters: [
    'default',
    [
      'jest-qase-reporter',
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
};
```

After:

<!-- project: config -->

```js
// jest.config.js
module.exports = {
  reporters: [
    'default',
    [
      '@probara/jest-reporter',
      { projectId: 'SHOP', run: { name: 'Nightly', tags: ['nightly'] }, captureOutput: true },
    ],
  ],
  setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
};
```

`captureOutput` and its setup file are optional: they attach each test's console output, which
Qase's `captureLogs` never did for Jest ([`captureOutput`](configuration.md#captureoutput)).

## Options and variables

| Qase option (`QASE_*` variable)                                      | Probara option (`PROBARA_*` variable)                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `mode: 'testops'` (`QASE_MODE`)                                      | On whenever a token and a project are set                                                              |
| `mode: 'off'`                                                        | `enabled: false` (`PROBARA_ENABLED=false`), or no token                                                |
| `mode: 'report'`, `fallback` (`QASE_FALLBACK`)                       | `resultsFile` (`PROBARA_RESULTS_FILE`) ([results file](results-file.md))                               |
| `mode: 'testops_multi'`, `testops_multi.*`                           | `projectId` plus `projects` and `run.ulids` ([several projects](projects.md#several-probara-projects)) |
| `debug` (`QASE_DEBUG`)                                               | `debug` (`PROBARA_DEBUG`)                                                                              |
| `environment` (`QASE_ENVIRONMENT`), a slug, ignored when not found   | `run.environment` (`PROBARA_ENVIRONMENT`), a name, created when missing                                |
| `rootSuite` (`QASE_ROOT_SUITE`)                                      | `suiteUlid` (`PROBARA_SUITE_ULID`): an existing suite, by ULID                                         |
| `captureLogs` (`QASE_CAPTURE_LOGS`): ignored by Qase's Jest reporter | `captureOutput` (`PROBARA_CAPTURE_OUTPUT`), with the setup file                                        |
| `statusMapping` (`QASE_STATUS_MAPPING`)                              | `statusMapping` (`PROBARA_STATUS_MAPPING`), without `invalid` and `disabled`                           |
| `logging.console`, `logging.file`                                    | Logs go to stderr; the `logger` option for code                                                        |
| `testops.api.token` (`QASE_TESTOPS_API_TOKEN`)                       | `PROBARA_API_TOKEN` (`apiToken` for code)                                                              |
| `testops.api.host` (`QASE_TESTOPS_API_HOST`)                         | `baseUrl` (`PROBARA_BASE_URL`), a full URL                                                             |
| `testops.api.timeout` (seconds)                                      | `timeoutMs` (milliseconds), for every request                                                          |
| `testops.api.retries`, `testops.api.retryBackoff`                    | `maxRetries`, for every request; the backoff is fixed ([network](network.md))                          |
| `testops.project` (`QASE_TESTOPS_PROJECT`)                           | `projectId` (`PROBARA_PROJECT`)                                                                        |
| `testops.uploadAttachments`                                          | `uploadAttachments` (`PROBARA_UPLOAD_ATTACHMENTS`)                                                     |
| `testops.attachments.concurrency`, `.timeout`                        | `attachmentConcurrency`; uploads get at least 120 s                                                    |
| `testops.run.id` (`QASE_TESTOPS_RUN_ID`)                             | `run.ulid` (`PROBARA_RUN_ULID`)                                                                        |
| `testops.run.title`, `.description`, `.tags`                         | `run.name`, `run.description`, `run.tags` (`PROBARA_RUN_*`)                                            |
| `testops.run.complete` (`QASE_TESTOPS_RUN_COMPLETE`)                 | `closeRun` (`PROBARA_CLOSE_RUN`); a created run is closed by default                                   |
| `testops.plan.id` (`QASE_TESTOPS_PLAN_ID`)                           | `run.plan` (`PROBARA_PLAN`): the plan's display id or name                                             |
| `testops.configurations.values` (`group=value`)                      | `run.configurations` (`PROBARA_CONFIGURATIONS=Group=Name`)                                             |
| `testops.statusFilter` (`QASE_TESTOPS_STATUS_FILTER`)                | `statusFilter` (`PROBARA_STATUS_FILTER`); `skipped` drops todo tests too                               |
| `testops.batch.size` (`QASE_TESTOPS_BATCH_SIZE`)                     | `chunkSize` (1 to 500)                                                                                 |
| (none)                                                               | `run.milestone` (`PROBARA_MILESTONE`): Qase's reporter has no milestone                                |

Qase settings without a counterpart are in [not ported](#not-ported).

## The `qase.*` calls

| Qase                                                      | Probara                                                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `test(qase(12, 'pays'), ...)`, `(Qase ID: 12)` in a title | `test('SHOP-12 pays', ...)`: an id in the title or a `describe` ([linking](linking.md))                   |
| `test(qase([12, 13], 'pays'), ...)`                       | `test('SHOP-12 SHOP-13 pays', ...)`, or `probara.id(['SHOP-12', 'SHOP-13'])`                              |
| `qase.projects({ WEB: [3] }, 'pays')`                     | `WEB-3` in the title, with `projects: ['WEB']` ([several projects](projects.md#several-probara-projects)) |
| (none: Qase's Jest reporter has no `qase.id()`)           | `probara.id('SHOP-12')`                                                                                   |
| `qase.title('...')`                                       | `probara.title('...')`                                                                                    |
| `qase.suite('Payments')`                                  | `probara.suite('Payments')`, or `probara.suite(['Payments', 'Cards'])` for nesting                        |
| `qase.fields({ severity: 'critical' })`                   | `probara.fields({ severity: 'critical' })`                                                                |
| `qase.tags('smoke')`                                      | `probara.tags('smoke')`                                                                                   |
| `qase.comment('...')`                                     | `probara.comment('...')`                                                                                  |
| `qase.ignore()`                                           | `probara.ignore()`                                                                                        |
| `qase.parameters({...})`, `qase.groupParameters({...})`   | `probara.parameters({...})`                                                                               |
| `qase.attach({ paths: [a, b] })`                          | `probara.attach({ name, path })`, once per file                                                           |
| `qase.attach({ name, content, type })`                    | `probara.attach({ name, body, contentType })`                                                             |
| `await qase.step('Pay', fn, 'Paid', 'card=visa')`         | `await probara.step('Pay', fn, { expected: 'Paid', data: 'card=visa' })`                                  |
| `s.step(...)`, `s.attach(...)` inside a step's body       | `probara.step(...)`, `probara.attach(...)` inside the body: they nest on their own                        |

Before:

<!-- not-run: Qase's reporter -->

```js
// tests/checkout.test.js
const { qase } = require('jest-qase-reporter/jest');

test(qase(12, 'pays with a card'), async () => {
  qase.fields({ severity: 'critical' });
  qase.tags('smoke');
  await qase.step('Pay', async () => {}, 'The order is paid');
  qase.attach({ name: 'order.json', content: '{"id":1042}', type: 'application/json' });
});
```

After:

<!-- project: after -->

```js
// tests/checkout.test.js
const { probara } = require('@probara/jest-reporter');

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
    "automationKey": "tests/checkout.test.js > pays with a card",
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

The id leaves the title and the key: adding or removing it never changes which case the test
matches ([automation keys](linking.md#automation-keys)).

## The helpers work in every worker

Qase's `qase.*` calls reach its reporter through a global of Jest's main process. That global exists
in a test only when Jest runs in band **and** the test environment is `node`: with workers (Jest's
default for more than one file), in `jsdom`, and always in watch mode, the calls throw and fail the
test. Jest also picks in band or workers on its own, from the timings of earlier runs, so the same
suite can pass one day and fail the next.

Probara's helpers write to a channel every worker can reach, and each call names its test by its
file, full name and attempt. They work in workers, in band, in `node` and `jsdom`, in watch mode,
and in `test.concurrent` tests; a call outside a running test is left out with a warning, never
thrown ([where to call the helpers](metadata.md#where-to-call-the-helpers)).

## What is different, and why

| Topic                               | Qase                                                                                                                    | Probara                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Precedence                          | Its code lets variables win over `qase.config.json`, which wins over the reporter options (its docs say the opposite)   | Options in the Jest config, then `PROBARA_*` variables, then defaults: what the config says is what runs                               |
| Config file                         | `qase.config.json` or `.qaserc`                                                                                         | None: a config file holding a token could be committed. Options live in the Jest config                                                |
| Case ids                            | Numbers, in the test's own title only                                                                                   | Display ids (`SHOP-12`) in the title or any `describe`: the project code routes each id to its project                                 |
| Attribution of metadata             | By timing: calls go to the next test that reports (`beforeAll` calls to the first, `afterAll` calls to the next file's) | By identity: each call belongs to the test running it; outside a test it is left out with a warning                                    |
| Steps                               | Flat, children before their parent; expected result and data encoded into the step name                                 | Nested as they ran, each with its status, duration and error; `expected` and `data` as options ([steps](steps.md))                     |
| Step attachments                    | Only through the step body's `s.attach()`; `qase.attach()` always goes to the test                                      | `probara.attach()` inside a step goes to that step ([attachments](attachments.md))                                                     |
| `test.failing`                      | A throwing body passes; a passing body is usually `invalid`                                                             | Jest's verdict: a throwing body passes, a passing body fails ([statuses](statuses.md))                                                 |
| Statuses                            | `invalid` for a failure whose error does not look like an assertion (a guess from the message)                          | `passed`, `failed`, `skipped`; `blocked` only through `statusMapping`. No guessing from error text                                     |
| `test.todo`                         | Skipped, but `statusFilter` needs `disabled` to drop it                                                                 | Skipped, with the note `Todo`; `statusFilter: ['skipped']` drops it                                                                    |
| Tests `-t` or `.only` left out      | Reported as skipped                                                                                                     | Reported as skipped too: Jest reports them as skipped, and the reporter sends what Jest reports                                        |
| A failing `afterAll`                | Not reported: the tests stay green in Qase                                                                              | One more failed result for the file, the one jest-junit writes ([statuses](statuses.md))                                               |
| A file that fails to load           | Nothing reported, nothing said                                                                                          | Nothing to report (no test ran), and one warning names the file                                                                        |
| `qase.comment()`                    | Replaces the error message of a failed result                                                                           | Written first in the notes, before the error, which is kept                                                                            |
| `fields()` and `parameters()` calls | The last call replaces the others                                                                                       | Merged by name                                                                                                                         |
| Case fields                         | Sent with every result                                                                                                  | Only when the report creates the case: an existing case keeps what people wrote ([created cases only](metadata.md#created-cases-only)) |
| Closing the run                     | Only with `run.complete: true`; unset leaves it open                                                                    | A run the reporter creates is closed at the end; a reused one stays open                                                               |
| Shards                              | Each shard makes its own run unless it gets a run id                                                                    | `probara run create`, every shard with `PROBARA_RUN_ULID`, then `probara run close` ([sharding](ci/sharding.md))                       |
| Watch mode                          | A new run per re-run; the helpers throw (never in band)                                                                 | One run for the whole session, left open ([watch mode](watch.md))                                                                      |
| When reporting fails                | `fallback` to a local report, for good, from the first error                                                            | A results file, sent later by `probara import results` into the same runs                                                              |
| Strings in `attach()`               | A string that looks like base64 is decoded (`'Hello'` uploads garbage)                                                  | A string is sent as it is; pass a `Buffer` for binary content                                                                          |
| `attach({ paths })`                 | Must be an array (a string is read character by character); the content type is `type`, not `contentType`               | One file per call, `path` or `body`, and `contentType`                                                                                 |
| The end of the run                  | Not awaited: `--forceExit` can cut the last results off                                                                 | Jest awaits the reporter: every result is sent before Jest exits                                                                       |
| Running only a plan's tests         | An external CLI (`qasectl`) builds a `-t` filter                                                                        | `runCasesOnly` runs only the tests of a run's cases ([run selection](run-selection.md))                                                |

## Not ported

| Qase feature                                                                       | Why                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public report link (`showPublicReportLink`)                                        | A public link to test results is a sharing decision for the Probara app, not something a CI job should turn on                                                                                                                          |
| Automatic defects (`testops.defect`)                                               | Filing a defect for every failure floods the defect list; report defects from the result in Probara                                                                                                                                     |
| Network profiler (`profilers: ['network']`)                                        | It records the main process's HTTP calls, which in Jest means in band only, and is noise; attach what matters instead                                                                                                                   |
| Jira link on runs (`run.externalLink`)                                             | Probara links Jira issues to cases and defects, where traceability lives; `probara.issue()` links a result to an issue                                                                                                                  |
| `qase.mute()`                                                                      | Documented by Qase, but it does not exist in its reporter                                                                                                                                                                               |
| Creating configurations (`createIfNotExists`)                                      | Configurations are part of a project's planning; an unknown one is refused, so a typo never creates a new one                                                                                                                           |
| The `invalid` status                                                               | It is a guess from the error text; Probara keeps four statuses and the whole error in the notes                                                                                                                                         |
| Logging to a file (`logging.file`)                                                 | Logs go to stderr, where CI keeps them; redirect stderr to keep a file                                                                                                                                                                  |
| Per-project plan and environment (`testops_multi.projects[].plan`, `.environment`) | Planning entities belong to one project, where an unknown name would refuse the report: create that project's run first with `probara run create` and pass it in `run.ulids` ([several projects](projects.md#several-probara-projects)) |

## See also

- [Configuration](configuration.md): every option.
- [Metadata](metadata.md) and [steps](steps.md): the helpers in detail.
- [Coming from other tools](coming-from-other-tools.md): Test IT, ReportPortal, Allure and TestRail.
