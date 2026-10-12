# Coming from other tools

**Short answer:** the reporter sends what the Vitest integrations of Qase, Allure, ReportPortal
and TestRail send, wherever Probara has a place for it: case links, the title, suite, fields, tags
and steps of a new case, parameters, comments, nested steps, files, links, and the run's name,
plan, environment and configurations. It also sends every attempt of a retried or repeated test,
which none of them does, and keeps one run for a whole watch session. What it does not port is
under [not supported](#not-supported), each with its reason.

| Tool         | Package                                            | How it hooks into Vitest                                                | Jump to                                                    |
| ------------ | -------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Qase         | `vitest-qase-reporter`                             | A reporter, and `withQase()` around each test function                  | [Migrating from Qase](migrating-from-qase.md)              |
| Allure       | `allure-vitest`                                    | A reporter that adds its setup file and runner, and writes result files | [Allure](#allure)                                          |
| ReportPortal | `@reportportal/agent-js-vitest`                    | A reporter object, and a setup file listed in `setupFiles`              | [ReportPortal](#reportportal)                              |
| TestRail     | Vitest's JUnit output, then `trcli parse_junit`    | JUnit XML, sent by a Python CLI after the run                           | [TestRail](#testrail)                                      |
| JUnit import | Vitest's JUnit output, then `probara import junit` | JUnit XML, sent by Probara's CLI after the run                          | [Migrating from the JUnit import](migrating-from-junit.md) |

Whatever you come from, the reporter is one entry in `reporters`. Nothing goes in `setupFiles` or
`runner`: the reporter adds its own setup file and runner to each Vitest project, in Node and in
browser mode.

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]],
  },
});
```

## Compared, feature by feature

`–` means the tool has nothing for it.

| Feature                                          | Qase                                            | Allure                                    | ReportPortal                                    | TestRail (`trcli`)                               | Probara                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Case ids in titles                               | `(Qase ID: 12)`, in the test's own title        | `@allure.id:12`, in the test's own title  | –                                               | `C12` in the name (`--case-matcher name`)        | `SHOP-12` in a test or `describe` title ([linking](linking.md))                                                                       |
| A case id from code                              | –                                               | `allureId()`                              | –                                               | A `test_id` property (`--case-matcher property`) | `probara.id()`                                                                                                                        |
| Several projects                                 | `testops_multi`, `(Qase WEB: 3)` in titles      | –                                         | –                                               | –                                                | `projects`: each case id goes to the project of its code ([several projects](projects.md#several-probara-projects))                   |
| Title, suite, fields and tags of a new case      | `title()`, `suite()`, `fields()`, `tags()`      | `displayName()`, labels, `description()`  | `description()`, `attributes()`                 | `--case-fields`                                  | `probara.title()`, `suite()`, `fields()`, `tags()`, and Vitest tags ([metadata](metadata.md))                                         |
| Parameters                                       | `parameters()`, `groupParameters()`             | `parameter()`, with modes                 | –                                               | –                                                | `probara.parameters()`, never in the key                                                                                              |
| A comment                                        | `comment()`, which replaces the error message   | –                                         | –                                               | `testrail_result_comment`                        | `probara.comment()`, before the errors                                                                                                |
| Steps                                            | `step()`, flat: a step that holds steps is lost | `step()`, nested; `logStep()`             | –                                               | `testrail_result_step`, flat                     | `probara.step()`, nested, with status and duration; the steps of a new case ([steps](steps.md))                                       |
| Files                                            | `attach()`: paths, or a string                  | `attachment()`, `attachmentPath()`        | `attachment()`                                  | `testrail_attachment`                            | `probara.attach()`, on a result or a step; the files of `context.annotate()`; failure screenshots ([attachments](attachments.md))     |
| Links of a result                                | – (a Jira link on the run)                      | `link()`, `issue()`, `tms()`              | –                                               | – (`--test-run-ref` on the run)                  | `probara.link()`, `probara.issue()` ([links](links.md))                                                                               |
| Console output                                   | – (`captureLogs` is ignored)                    | –                                         | Logs, with a level guessed from the text        | –                                                | `captureOutput`: `stdout.log` and `stderr.log` of each attempt ([captured output](output.md))                                         |
| An error that is not an assertion                | `invalid`, guessed from the message             | `broken`                                  | Failed                                          | Failed                                           | `failed` ([statuses](statuses.md))                                                                                                    |
| The errors of a failed test                      | The first message, and every stack              | The first error                           | The first error                                 | The first `<failure>`                            | Every error of the attempt, `expect.soft` included                                                                                    |
| `test.skip`, and tests `.only` or `-t` leave out | Skipped                                         | Not reported                              | Skipped                                         | Retest                                           | Skipped                                                                                                                               |
| `test.todo`                                      | Skipped                                         | Written without a status                  | Skipped, with a `todo` attribute                | Retest                                           | Skipped, with the note `Todo`                                                                                                         |
| Retries and repeats                              | The final execution                             | The final execution                       | The final execution                             | One result per test                              | Every execution is a result ([retries](retries.md))                                                                                   |
| `test.concurrent`                                | Each call goes to its own test                  | Its own test, through a runner of its own | The global `ReportingApi` can name another test | –                                                | Its own test, through the reporter's runner; in a browser, dropped with a warning ([metadata](metadata.md#where-to-call-the-helpers)) |
| Vitest projects                                  | –                                               | The project leads the title path          | –                                               | –                                                | A `project` parameter, never in the key ([projects](projects.md#vitest-projects))                                                     |
| Browser mode                                     | Not supported                                   | Supported                                 | Not supported                                   | –                                                | Supported ([browser mode](browser-mode.md))                                                                                           |
| Shards                                           | A shared run id; another step closes the run    | A shared results folder                   | A shared launch id; another step finishes it    | A glob over the shards' XML files                | `vitest --merge-reports` over the blobs, or `probara run create` and `run close` ([closing](runs.md#closing))                         |
| Watch mode                                       | A new run for each re-run                       | New result files for each re-run          | The launch ends with the first run              | –                                                | One run for the whole session ([watch mode](watch.md))                                                                                |
| Name, description and tags of the run            | `run.title`, `.description`, `.tags`            | –                                         | `launch`, `description`, `attributes`           | `--title`, `--run-description`                   | `run.name`, `run.description`, `run.tags` ([run options](runs.md))                                                                    |
| Plan, milestone, environment, configurations     | Plan, environment, configurations               | `environmentInfo`                         | –                                               | `--plan-id`, `--milestone-id`, `--config-ids`    | All four, by display id or name                                                                                                       |
| An existing run                                  | `run.id`                                        | –                                         | `launchId`                                      | `--run-id`                                       | `run.ulid`, left open ([an existing run](runs.md#an-existing-run))                                                                    |
| Run only the tests of a run                      | –                                               | A test plan file (`ALLURE_TESTPLAN_PATH`) | –                                               | –                                                | `runCasesOnly` ([run selection](run-selection.md))                                                                                    |
| Assign failed results                            | –                                               | –                                         | –                                               | `--assign`                                       | `assignFailedTo` ([assign failed results](assign-failed.md))                                                                          |
| When sending fails                               | `fallback` to a local report                    | – (it writes files)                       | Logged                                          | Rolls back what it created                       | A results file, sent later by `probara import results` ([results file](results-file.md))                                              |
| New cases                                        | Created by Qase                                 | – (no cases)                              | – (test items, not cases)                       | With `-y`                                        | Created by automation key, under `suiteUlid` ([missing cases](linking.md#missing-cases))                                              |

## Allure

`allure-vitest` is a reporter that adds its setup file and its runner to each Vitest project, and
writes result files into `allure-results/`; a separate step turns them into a report. The reporter
sends the results to Probara instead, and adds its own setup file and runner the same way: swap
the entries.

<!-- not-run: Allure's reporter -->

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: [
      'default',
      [
        'allure-vitest/reporter',
        {
          resultsDir: 'allure-results',
          links: { issue: { urlTemplate: 'https://jira.example.com/browse/%s' } },
        },
      ],
    ],
  },
});
```

### Settings

| Allure                                      | Probara                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `resultsDir`                                | Nothing: results go to Probara. A [results file](results-file.md) keeps what could not be sent          |
| `links.issue.urlTemplate`                   | `issueUrlTemplate` (`PROBARA_ISSUE_URL_TEMPLATE`) ([links](links.md#probaraissue-and-issueurltemplate)) |
| `environmentInfo`                           | `run.environment` (a name) and the run source, detected from the CI ([run options](runs.md))            |
| `globalLabels`, `ALLURE_LABEL_*`            | `run.tags` (`PROBARA_RUN_TAGS`) for the run; the tags of a new case come from `probara.tags()`          |
| `ALLURE_TESTPLAN_PATH`                      | `runCasesOnly` with `PROBARA_RUN_ULID` ([run selection](run-selection.md))                              |
| `reportMatchers`, `categories`, `listeners` | Not ported ([not supported](#not-supported))                                                            |

### Calls

Allure's calls are async (`await allure.tags('smoke')`); Probara's return at once, except
`probara.attach()` and a `probara.step()` with an async body, which you await.

| Allure (`allure-js-commons`)                     | Probara (`probara.*`)                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `@allure.id:12` in a title, `allureId('12')`     | `SHOP-12` in the title or a `describe`, or `id('SHOP-12')`                     |
| `displayName('...')`                             | `title('...')`                                                                 |
| `description('...')`                             | `fields({ description: '...' })`                                               |
| `severity('critical')`, `layer('api')`           | `fields({ severity: 'critical', layer: 'api' })`                               |
| `tag('smoke')`, `tags(...)`                      | `tags('smoke')`                                                                |
| `epic`, `feature`, `story`, `label(name, value)` | `fields({ Feature: 'Checkout' })`: a custom field of that name, or `tags(...)` |
| `parentSuite`, `suite`, `subSuite`               | `suite(['Payments', 'Cards'])`                                                 |
| `parameter('user', 'ana')`                       | `parameters({ user: 'ana' })`                                                  |
| `step('Pay', async () => {...})`                 | `step('Pay', async () => {...})` ([steps](steps.md))                           |
| `logStep('Paid')`                                | `step('Paid')`: a step without a body, passed                                  |
| `attachment(name, content, { contentType })`     | `attach({ name, body: content, contentType })`                                 |
| `attachmentPath(name, path)`                     | `attach({ name, path })`                                                       |
| `link(url, name)`                                | `link(url, name)` ([links](links.md))                                          |
| `issue('PAY-7')`                                 | `issue('PAY-7')`, with `issueUrlTemplate`                                      |
| `tms('12')`                                      | `id('SHOP-12')`                                                                |

<!-- project: allure-after -->

```ts
reporters: [
  'default',
  ['@probara/vitest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
],
```

<!-- project: allure-after -->

```ts
// tests/payments.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('refunds an order', async () => {
  probara.fields({ severity: 'critical' }).issue('PAY-7');
  await probara.step('Open the order', async () => {});
  await probara.step('Refund it', async () => {});
});
```

<!-- sent: allure-after -->

```json
[
  {
    "automationKey": "tests/payments.test.ts > refunds an order",
    "steps": [
      { "action": "Open the order", "status": "passed" },
      { "action": "Refund it", "status": "passed" }
    ],
    "links": [{ "url": "https://jira.example.com/browse/PAY-7", "name": "PAY-7" }],
    "case": {
      "fields": { "severity": "critical" },
      "steps": [{ "action": "Open the order" }, { "action": "Refund it" }]
    }
  }
]
```

### What works differently

| Topic                             | Allure                                                                     | Probara                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statuses                          | `failed` for an assertion, `broken` for any other error                    | `failed` for both, with the error in the notes: no guess from the error's type ([statuses](statuses.md))                                                                                                               |
| `test.skip`, a skipped `describe` | Not reported                                                               | Skipped results, as Vitest's JUnit output has them                                                                                                                                                                     |
| Assertions                        | Each `expect` is a step (`reportMatchers`, on by default)                  | The steps are the `probara.step()` calls                                                                                                                                                                               |
| A call where no test runs         | A call in `beforeAll` or a `describe` body goes to every test of the suite | Left out, with one warning: no single test runs there ([where to call the helpers](metadata.md#where-to-call-the-helpers))                                                                                             |
| A hook that throws                | Its error is a global error of the report, beside the tests                | Vitest's verdict: a failing `beforeEach` or `afterEach` fails its test, a failing `beforeAll` or `afterAll` is a failed result for its `describe` or file ([errors outside a test](statuses.md#errors-outside-a-test)) |
| Retries                           | One result per test, the final attempt                                     | Every attempt is a result of the run ([retries](retries.md))                                                                                                                                                           |
| Watch mode                        | New result files on every re-run, which pile up in `resultsDir`            | One run for the whole session ([watch mode](watch.md))                                                                                                                                                                 |
| Case fields                       | Labels on every result                                                     | Fields and tags of the case a report creates; an existing case keeps its own ([created cases only](metadata.md#created-cases-only))                                                                                    |
| `test.concurrent` in browser mode | A call can go to the wrong test after an `await` (its README says so)      | A call is dropped with a warning, never recorded in another test ([browser mode](browser-mode.md#not-supported-yet))                                                                                                   |

## ReportPortal

`@reportportal/agent-js-vitest` is a reporter object in `reporters`, with a setup file you list in
`setupFiles` for its `ReportingApi`. Replace both with the reporter entry above:

<!-- not-run: ReportPortal's agent -->

```ts
// vitest.config.mts
import RPReporter from '@reportportal/agent-js-vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['@reportportal/agent-js-vitest/setup'],
    reporters: [
      'default',
      new RPReporter({
        apiKey: process.env.RP_API_KEY,
        endpoint: 'https://rp.example.com/api/v2',
        project: 'shop',
        launch: 'Nightly',
      }),
    ],
  },
});
```

### Settings

| ReportPortal (variable)                             | Probara (variable)                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apiKey`, `oauth`                                   | `PROBARA_API_TOKEN`: an app token from the **Vitest** card ([get a token](configuration.md#get-a-token))   |
| `endpoint`                                          | `baseUrl` (`PROBARA_BASE_URL`), the app's URL without a path                                               |
| `project`                                           | `projectId` (`PROBARA_PROJECT`)                                                                            |
| `launch`                                            | `run.name` (`PROBARA_RUN_NAME`)                                                                            |
| `description`                                       | `run.description` (`PROBARA_RUN_DESCRIPTION`)                                                              |
| `attributes` (`[{ key: 'build', value: '42' }]`)    | `run.tags` (`PROBARA_RUN_TAGS=build:42,nightly`): tags are plain names, a colon included                   |
| `launchId` (`RP_LAUNCH_ID`)                         | `run.ulid` (`PROBARA_RUN_ULID`)                                                                            |
| `launchUuidPrint`                                   | `probara run create` prints the ULID every shard reports into ([an existing run](runs.md#an-existing-run)) |
| `restClientConfig` (timeout, retries, proxy)        | `timeoutMs`, `maxRetries`; a proxy through Node's variables ([network](network.md))                        |
| `headers`                                           | A `fetch` of your own ([network](network.md#your-own-http-client))                                         |
| `debug`                                             | `debug` (`PROBARA_DEBUG`)                                                                                  |
| `extendTestDescriptionWithLastError`                | Nothing to set: every error of an attempt is in its notes                                                  |
| `skippedIssue`, `rerun`, `rerunOf`, `mode: 'DEBUG'` | Not ported ([not supported](#not-supported))                                                               |

### Calls

| ReportPortal (`ReportingApi`)                            | Probara (`probara.*`)                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ReportingApi.attachment(task, { name, type, content })` | `attach({ name, body, contentType })`, with a `Buffer` or text, or `attach({ name, path })`   |
| `ReportingApi.description(task, text)`                   | `fields({ description: text })`, for a new case                                               |
| `ReportingApi.attributes(task, [{ key, value }])`        | `parameters({ [key]: value })` on the result, or `tags(value)` on a new case                  |
| `ReportingApi.testCaseId(task, id)`                      | Not ported: link a case by its id instead ([linking](linking.md))                             |
| `ReportingApi.log(task, message, level)`                 | Not ported: `comment()` for a line in the notes, `captureOutput` for the console              |
| `console.log()`, `console.error()`, as logs              | `captureOutput`: `stdout.log` and `stderr.log` of each attempt ([captured output](output.md)) |
| The global `ReportingApi` of the setup file              | `probara`, imported: there is no `task` to pass                                               |

A base64 string as `content` would be sent as text: give `attach()` the file's `path`, or its
bytes as a `Buffer`.

<!-- project: reportportal-after -->

```ts
// tests/checkout.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('pays with a card', async () => {
  probara.fields({ description: 'Pays with a saved card' }).parameters({ browser: 'chromium' });
  await probara.attach({
    name: 'response',
    body: '{"status":"paid"}',
    contentType: 'application/json',
  });
});
```

<!-- sent: reportportal-after -->

```json
[
  {
    "automationKey": "tests/checkout.test.ts > pays with a card",
    "parameters": { "browser": "chromium" },
    "case": { "description": "Pays with a saved card" }
  }
]
```

<!-- files: reportportal-after -->

```text
response.json application/json
```

### What works differently

| Topic                | ReportPortal                                                                                   | Probara                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| In-test API          | `ReportingApi`, global from its setup file, or with the test's `task` passed in                | `probara`, imported; each call belongs to the test that made it ([metadata](metadata.md)) |
| `test.concurrent`    | The global `ReportingApi` follows the last test that started, so a call can go to another test | Each call goes to its own test                                                            |
| Retries              | The final attempt only                                                                         | Every attempt is a result ([retries](retries.md))                                         |
| `test.todo`          | Skipped, with the attribute `todo`                                                             | Skipped, with the note `Todo`                                                             |
| A skipped `describe` | One skipped suite item; its tests are not reported                                             | Each test is a skipped result                                                             |
| Errors               | The first error, as a log and in the description                                               | Every error of the attempt, in the notes of its result                                    |
| Structure            | A suite item per `describe`                                                                    | Each new case in a suite named after its file ([missing cases](linking.md#missing-cases)) |
| Watch mode           | The launch ends with the first run, and the re-runs have none                                  | One run for the whole session ([watch mode](watch.md))                                    |

## TestRail

TestRail has no Vitest reporter: a pipeline writes Vitest's JUnit output, then TestRail's Python
CLI `trcli parse_junit` sends it after the run. The reporter replaces both steps, and sends what
the XML cannot hold: steps, files, comments and every attempt.

<!-- not-run: Vitest's JUnit output and TestRail's trcli -->

```bash
npx vitest run --reporter=junit --outputFile=reports/vitest.xml
trcli -h https://example.testrail.io --project "Shop" -u ci@example.com -k "$TESTRAIL_KEY" \
  parse_junit --title "Nightly" --case-matcher name -f reports/vitest.xml --close-run
```

With the reporter, the test step is enough:

```bash
npx vitest run
```

### Settings

| trcli                                         | Probara                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `-h` (host), `-u`, `-p`, `-k`                 | `baseUrl` for a self-hosted Probara; `PROBARA_API_TOKEN`                                          |
| `--project` (a name)                          | `projectId` (`PROBARA_PROJECT`), the project code                                                 |
| `--title`, `--run-description`                | `run.name`, `run.description`                                                                     |
| `--run-id`                                    | `run.ulid` (`PROBARA_RUN_ULID`)                                                                   |
| `--plan-id`, `--config-ids`, `--milestone-id` | `run.plan`, `run.configurations`, `run.milestone`, by display id or name ([run options](runs.md)) |
| `--close-run`                                 | The default for a run the reporter creates; `closeRun` for a reused one                           |
| `--case-matcher name` (`C123` in the name)    | `SHOP-12` in the title or a `describe` ([linking](linking.md))                                    |
| `--case-matcher auto` (`classname.name`)      | The automation key: the file, the describes and the title                                         |
| `-y` (create sections and cases)              | `createMissingCases`, on by default; suites from the test file                                    |
| `--suite-id`, `--section-id`                  | `suiteUlid` (`PROBARA_SUITE_ULID`): the suite created cases go under                              |
| `--case-fields type_id:3`                     | `probara.fields({ type: 'Regression' })` in the test, by name ([metadata](metadata.md))           |
| `-a`, `--assign` (emails)                     | `assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO`) ([assign failed results](assign-failed.md))         |
| `-b`, `--batch-size`                          | `chunkSize` (1 to 500)                                                                            |
| `-t`, `--timeout` (seconds)                   | `timeoutMs` (milliseconds, for each attempt of a request)                                         |
| `--proxy`, `--noproxy`                        | `HTTPS_PROXY` and `NO_PROXY` with `NODE_USE_ENV_PROXY=1` ([network](network.md#proxies))          |
| `-v` (verbose)                                | `debug` (`PROBARA_DEBUG`)                                                                         |
| `testrail_result_comment` property            | `probara.comment()`                                                                               |
| `testrail_attachment` property                | `probara.attach()`                                                                                |
| `testrail_result_step` property               | `probara.step()`                                                                                  |

### What works differently

| Topic              | trcli on Vitest's JUnit output                                  | Probara                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skipped tests      | Retest                                                          | Skipped                                                                                                                                                               |
| `test.todo`        | Retest: Vitest writes it as skipped                             | Skipped, with the note `Todo`                                                                                                                                         |
| Retries            | One result per test                                             | Every attempt ([retries](retries.md))                                                                                                                                 |
| Nested describes   | One section per test file, flat: Vitest writes a suite per file | The suite of a created case is its file; `probara.suite()` names nested suites                                                                                        |
| Durations          | Rounded to seconds (`--allow-ms` for milliseconds)              | Milliseconds, and the start of each attempt                                                                                                                           |
| An unknown case id | Aborts the upload                                               | That result is not recorded, and the log names it; the others are                                                                                                     |
| A failed upload    | Rolls back the run, cases and sections it created               | Nothing is rolled back; a [results file](results-file.md) keeps what was not sent                                                                                     |
| Shards             | One upload of every shard's file, with a glob                   | `vitest --merge-reports` over the blobs, or `probara run create`, `PROBARA_RUN_ULID` in every shard, `probara run close` ([an existing run](runs.md#an-existing-run)) |

## Not supported

Each of these is left out, with the reason:

| Feature                                          | In                                                                                                    | Why                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Updating existing cases                          | trcli (`--update-existing-cases`, `--update-strategy`)                                                | A report never changes an existing case: people own what is written there ([created cases only](metadata.md#created-cases-only))                                                                                                                                      |
| A flaky flag                                     | Vitest (`diagnostic().flaky`)                                                                         | Every attempt is a result: a case whose history mixes failures and passes on one run is flaky, without a flag ([retries](retries.md))                                                                                                                                 |
| Assertions as steps                              | Allure (`reportMatchers`)                                                                             | Each `expect` would be a step, up to the 200 steps of a result, crowding out the steps that say what the test does: wrap what matters in `probara.step()`                                                                                                             |
| The `broken` and `invalid` statuses              | Allure (`broken`), Qase (`invalid`)                                                                   | Both are a guess from the error's type or text; Probara keeps four statuses (`passed`, `failed`, `skipped`, `blocked`) and the whole error in the notes                                                                                                               |
| Masked, hidden and excluded parameters           | Allure (the modes of `parameter()`)                                                                   | Parameters are shown with the result and never part of the key: leave a secret out rather than masking it                                                                                                                                                             |
| Log levels and a log API                         | ReportPortal (`ReportingApi.log()`), Allure (`logStep()` with a status)                               | Probara has no log entity: `captureOutput` keeps each attempt's console output, `probara.comment()` writes a line in the notes, and a step's status is what its body did                                                                                              |
| Defects, Jira links on runs, public report links | Qase (`testops.defect`, `run.externalLink`, `showPublicReportLink`)                                   | Defects and their triage live in Probara, on the results; `probara.issue()` links a result to an issue; a public link to results is a sharing decision, not a CI setting                                                                                              |
| A network profiler                               | Qase (`profilers: ['network']`)                                                                       | Its steps are noise, up to the 200 steps of a result, and cannot be told apart when tests run in parallel ([network](network.md#not-supported-a-network-profiler))                                                                                                    |
| Categories, known issues, muted tests            | Allure (`categories`), ReportPortal (`skippedIssue`), Qase (`qase.mute()`, documented only)           | Triage lives in Probara, on the results and defects, not in a CI setting                                                                                                                                                                                              |
| Overriding the automation key                    | Allure (`historyId()`, `testCaseId()`), ReportPortal (`testCaseId()`), trcli (`custom_automation_id`) | The key comes from the file and the names, the same as `probara import junit`'s: link a case by its id instead ([automation keys](linking.md#automation-keys))                                                                                                        |
| An owner                                         | Allure (`owner()`)                                                                                    | A Probara case has no owner field: assign failed results instead ([assign failed results](assign-failed.md))                                                                                                                                                          |
| Result fields                                    | trcli (`--result-fields`, `testrail_result_field`)                                                    | Probara results have no custom fields: parameters (`probara.parameters()`) and links (`probara.link()`) carry the extra data                                                                                                                                          |
| Steps and calls from suite hooks                 | Allure (a call in `beforeAll` goes to every test of the suite)                                        | A call where no single test runs belongs to no test: it is left out with a warning, not copied into each one. Make the steps that matter in the test or its `beforeEach`; a hook that throws still shows ([errors outside a test](statuses.md#errors-outside-a-test)) |
| A config file                                    | Qase (`qase.config.json`, `.qaserc`), trcli (`config.yml`)                                            | A file holding a token could be committed: the token stays in the environment, the options in the Vitest config ([configuration](configuration.md))                                                                                                                   |
| Benchmarks and coverage                          | Vitest (`vitest bench`, `--coverage`)                                                                 | Probara has no benchmark or coverage results: the reporter sends test results                                                                                                                                                                                         |
| Type tests                                       | Vitest (`vitest typecheck`)                                                                           | No test of the reporter covers them, so nothing is promised for them                                                                                                                                                                                                  |
| Rerun and debug launches                         | ReportPortal (`rerun`, `rerunOf`, `mode: 'DEBUG'`)                                                    | Report again into the same run with `run.ulid`: each run case keeps the last outcome and its history. To try a setup, [check what would be sent](debugging.md#check-what-would-be-sent)                                                                               |
| Signing in with OAuth                            | ReportPortal (`oauth`)                                                                                | CI reports with an app token of the organization, which uses no seat and outlives the person who made it                                                                                                                                                              |
| Global files and errors                          | Allure (`globalAttachment()`, `globalError()`)                                                        | Files and errors belong to a result: attach them from the test that produced them                                                                                                                                                                                     |
| HTML descriptions                                | Allure (`descriptionHtml()`)                                                                          | The description is text; Probara formats it                                                                                                                                                                                                                           |
| Listeners                                        | Allure (`listeners`)                                                                                  | No hook changes a result before it is sent; `statusMapping` and `statusFilter` cover statuses ([statuses](statuses.md#status-mapping-and-filter))                                                                                                                     |
| Turning TLS verification off                     | trcli (`--insecure`)                                                                                  | It cannot be turned off: give Node your certificate authority instead ([network](network.md#custom-certificate-authorities))                                                                                                                                          |
| Rolling back a failed upload                     | trcli                                                                                                 | A result recorded is kept: rolling back would lose the ones that went through                                                                                                                                                                                         |
| References on runs                               | trcli (`--test-run-ref`)                                                                              | The run records its CI build URL, branch and commit; issues link to results with `probara.issue()`                                                                                                                                                                    |

## See also

- [Migrating from Qase](migrating-from-qase.md).
- [Migrating from the JUnit import](migrating-from-junit.md).
- [Configuration](configuration.md): every option.
- [Metadata](metadata.md#differences-from-the-jest-api): what the Vitest reporter changes from
  Probara's Jest reporter.
