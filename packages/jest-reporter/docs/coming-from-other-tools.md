# Coming from other tools

This page maps the Jest integrations of Test IT, ReportPortal, Allure and TestRail to the reporter:
their settings and calls next to Probara's, what works differently and why, and what is not
ported. Coming from Qase, see [migrating from Qase](migrating-from-qase.md); from jest-junit and
`probara import junit`, see [migrating from the JUnit import](migrating-from-junit.md).

| Tool         | Package                            | How it hooks into Jest                        | Jump to                       |
| ------------ | ---------------------------------- | --------------------------------------------- | ----------------------------- |
| Test IT      | `testit-adapter-jest`              | A test environment, plus `globalSetup`        | [Test IT](#test-it)           |
| ReportPortal | `@reportportal/agent-js-jest`      | A reporter                                    | [ReportPortal](#reportportal) |
| Allure       | `allure-jest`                      | A test environment that writes result files   | [Allure](#allure)             |
| TestRail     | `jest-junit` + `trcli parse_junit` | JUnit XML, sent by a Python CLI after the run | [TestRail](#testrail)         |

Whatever you come from, the reporter is one entry in `reporters`, with an optional setup file, and
the `probara.*` helpers work in every Jest worker, in band, in `node` and `jsdom` environments, and
in watch mode ([metadata](metadata.md#where-to-call-the-helpers)). You keep your own
`testEnvironment`.

<!-- project: basic -->

```js
// jest.config.js
module.exports = {
  reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
  setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
};
```

The setup file is needed only for [`captureOutput`](configuration.md#captureoutput) and
[run selection](run-selection.md).

## Test IT

`testit-adapter-jest` is a test environment (`testEnvironment: 'testit-adapter-jest'`) with a
`globalSetup` and a `globalTeardown`: each worker sends its own results to Test IT, test file by
test file. Replace all three with the reporter entry above.

<!-- not-run: Test IT's adapter -->

```js
// jest.config.js
module.exports = {
  testEnvironment: 'testit-adapter-jest',
  globalSetup: 'testit-adapter-jest/dist/globalSetup.js',
  globalTeardown: 'testit-adapter-jest/dist/globalTeardown.js',
  testEnvironmentOptions: {
    url: 'https://testit.example.com',
    projectId: '5236eb3f-7c05-46f9-a609-dc0278896464',
    adapterMode: 2,
    testRunName: 'Nightly',
  },
};
```

### Settings

| Test IT (variable)                                        | Probara (variable)                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `url` (`TMS_URL`)                                         | `baseUrl` (`PROBARA_BASE_URL`), only for a self-hosted Probara                                         |
| `privateToken` (`TMS_PRIVATE_TOKEN`)                      | `PROBARA_API_TOKEN`: an app token from the **Jest** card ([get a token](configuration.md#get-a-token)) |
| `projectId` (`TMS_PROJECT_ID`), a UUID                    | `projectId` (`PROBARA_PROJECT`), the project code (`SHOP`)                                             |
| `configurationId` (`TMS_CONFIGURATION_ID`)                | `run.configurations` (`PROBARA_CONFIGURATIONS=Browser=Chrome`), by name                                |
| `adapterMode: 2`, a new run                               | The default: each `jest` creates a run and closes it at the end                                        |
| `adapterMode: 1` and `testRunId` (`TMS_TEST_RUN_ID`)      | `run.ulid` (`PROBARA_RUN_ULID`): report into an existing run, left open                                |
| `testRunName` (`TMS_TEST_RUN_NAME`)                       | `run.name` (`PROBARA_RUN_NAME`), for a new run only                                                    |
| `testRunTags` (`TMS_TEST_RUN_TAGS`)                       | `run.tags` (`PROBARA_RUN_TAGS`)                                                                        |
| `automaticCreationTestCases`                              | `createMissingCases` (`PROBARA_CREATE_MISSING_CASES`), on by default                                   |
| `syncStorageEnabled`, `syncStoragePort`, `importRealtime` | Nothing to set: every result goes through the reporter in Jest's main process                          |
| `LOG_LEVEL=debug`                                         | `debug` (`PROBARA_DEBUG`)                                                                              |

### Calls

| Test IT (`testit.*`)                          | Probara (`probara.*`)                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `workItemIds(['1042'])`, `workItemId('1042')` | `id('SHOP-12')`, or `SHOP-12` in the title or a `describe` ([linking](linking.md)) |
| `displayName('...')`, `title('...')`          | `title('...')`: the title of the case a report creates                             |
| `description('...')`                          | `fields({ description: '...' })`                                                   |
| `labels(['smoke'])`, `tags(['smoke'])`        | `tags('smoke')`                                                                    |
| `layer('API')`                                | `fields({ layer: 'API' })`, a system field of the case                             |
| `namespace('...')`, `classname('...')`        | `suite(['...', '...'])`: the suite path of the case a report creates               |
| `params({ user: 'ana' })`                     | `parameters({ user: 'ana' })`                                                      |
| `step('Pay', 'description')`                  | `step('Pay', () => {...}, { expected: '...' })`: nested, with status and duration  |
| `addAttachments(['a.png'])`                   | `attach({ name: 'a.png', path: 'a.png' })`, once per file                          |
| `addAttachments('text', 'log.txt')`           | `attach({ name: 'log.txt', body: 'text' })`                                        |
| `addLinks({ url, title })`, `links([...])`    | `link(url, title)`, once per link ([links](links.md))                              |
| `addMessage('...')`                           | `comment('...')`                                                                   |

<!-- project: testit-after -->

```js
// tests/checkout.test.js
const { probara } = require('@probara/jest-reporter');

describe('checkout', () => {
  test('pays with a card', () => {
    probara
      .id('SHOP-12')
      .parameters({ user: 'ana' })
      .comment('Paid against the staging gateway')
      .link('https://ci.example.com/build/42', 'Build 42');
  });
});
```

<!-- sent: testit-after -->

```json
[
  {
    "caseDisplayId": "SHOP-12",
    "automationKey": "tests/checkout.test.js > checkout pays with a card",
    "parameters": { "user": "ana" },
    "notes": "Paid against the staging gateway",
    "links": [{ "url": "https://ci.example.com/build/42", "name": "Build 42" }]
  }
]
```

### What works differently

| Topic                         | Test IT                                                                                              | Probara                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Identity                      | A hash of the file and the test's own title: two tests with one title in different describes collide | The file, every describe and the title ([automation keys](linking.md#automation-keys))                 |
| Skipped and `test.todo` tests | Not reported                                                                                         | Reported as skipped (`Todo` in the notes of a todo) ([statuses](statuses.md))                          |
| Steps                         | Flat, without a status or a duration                                                                 | Nested, each with its status, duration and error ([steps](steps.md))                                   |
| `test.concurrent`             | One buffer per test file: concurrent tests overwrite each other's data                               | Each call belongs to the test that made it                                                             |
| Closing the run               | Never closed by the adapter                                                                          | A run the reporter creates is closed at the end; a reused one stays open                               |
| An existing run's name        | Renamed to `testRunName`                                                                             | Never changed: the options of a new run are ignored for a reused one, with a warning ([runs](runs.md)) |
| Precedence                    | Differs by type: strings from the options first, booleans from `tms.config.json` first               | Options, then `PROBARA_*` variables, then defaults, for every setting                                  |
| Running a run's tests         | An external CLI writes a `-t` filter                                                                 | `runCasesOnly` reads the run's cases itself ([run selection](run-selection.md))                        |

### Not ported

| Test IT                                                 | Why                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `automaticUpdationLinksToTestCases`, updating autotests | A report never changes an existing case: people own what is written there ([created cases only](metadata.md#created-cases-only)) |
| `testit.externalId()`                                   | The key comes from the file and the names, the same as `probara import junit`'s; link a case by its id instead                   |
| Setup and teardown steps from hooks                     | Hooks are how a test runs, not what it specifies; wrap what matters in `probara.step()`                                          |
| `testRunLinks` (links on the run)                       | The run records its CI build URL, branch and commit on its own; links belong to results (`probara.link()`)                       |
| `certValidation: false`                                 | TLS verification cannot be turned off; give Node your certificate authority instead ([network](network.md))                      |

## ReportPortal

`@reportportal/agent-js-jest` is a reporter, like this one. Swap the entry and its options:

<!-- not-run: ReportPortal's agent -->

```js
// jest.config.js
module.exports = {
  reporters: [
    'default',
    [
      '@reportportal/agent-js-jest',
      { endpoint: 'https://rp.example.com/api/v1', project: 'shop', launch: 'Nightly' },
    ],
  ],
};
```

### Settings

| ReportPortal (variable)                         | Probara (variable)                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apiKey` (`RP_API_KEY`, `RP_TOKEN`)             | `PROBARA_API_TOKEN`                                                                               |
| `endpoint` (`RP_ENDPOINT`)                      | `baseUrl` (`PROBARA_BASE_URL`), the app's URL without a path                                      |
| `project` (`RP_PROJECT_NAME`)                   | `projectId` (`PROBARA_PROJECT`)                                                                   |
| `launch` (`RP_LAUNCH`)                          | `run.name` (`PROBARA_RUN_NAME`)                                                                   |
| `description` (`RP_DESCRIPTION`)                | `run.description` (`PROBARA_RUN_DESCRIPTION`)                                                     |
| `attributes` (`RP_ATTRIBUTES=build:42,nightly`) | `run.tags` (`PROBARA_RUN_TAGS=build:42,nightly`): tags are plain names, a colon included          |
| `launchId` (`RP_LAUNCH_ID`)                     | `run.ulid` (`PROBARA_RUN_ULID`)                                                                   |
| `isLaunchMergeRequired`, `launchUuidPrint`      | `probara run create` prints the ULID every shard reports into ([sharding](ci/sharding.md))        |
| `restClientConfig` (timeout, retries)           | `timeoutMs`, `maxRetries` ([network](network.md))                                                 |
| `debug`                                         | `debug` (`PROBARA_DEBUG`)                                                                         |
| `ReportingApi.attachment(file, description)`    | `probara.attach({ name, path })` or `{ name, body, contentType }` ([attachments](attachments.md)) |

### What works differently

| Topic                    | ReportPortal                                                                                                                  | Probara                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| In-test API              | Only `attachment`, and only in band: it lives in the reporter's process                                                       | Every helper, in every worker ([metadata](metadata.md))                               |
| Retries                  | Every attempt, flagged `retry` when its code reference was seen before in the process (watch re-runs and duplicate names too) | Every attempt is a result, with no flag: the history shows it ([retries](retries.md)) |
| `test.todo`              | Never reported                                                                                                                | Skipped, with the note `Todo`                                                         |
| Errors                   | The first failure message, as a log and in the description                                                                    | Every error of the attempt, in the notes of its result                                |
| Structure                | A suite item per `describe`; the file is not an item                                                                          | Each case in a suite named after its file ([linking](linking.md#missing-cases))       |
| Settings from jest-junit | Its `jest-junit` section of `package.json` and `JEST_JUNIT_*` variables override its options                                  | Only the reporter's options and `PROBARA_*` variables                                 |

### Not ported

| ReportPortal                                   | Why                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `skippedIssue` and the `NOT_ISSUE` defect type | Known issues and defect triage live in Probara, on the result, not in a CI setting                                   |
| `rerun`, `rerunOf`                             | Report into the same run with `run.ulid`: each run case keeps the last outcome and its whole history                 |
| `mode: 'DEBUG'` launches                       | A debug run is a run: turn reporting off locally (no token), or check what would be sent ([debugging](debugging.md)) |
| OAuth sign-in                                  | CI reports with an app token of the organization, which uses no seat and outlives the person who made it             |

## Allure

`allure-jest` is a test environment (`allure-jest/node`, `allure-jest/jsdom`) that writes result
files into `allure-results/`; a separate step turns them into a report. The reporter sends results
to Probara as the run ends, and needs no environment: put back `node`, `jsdom` or your own.

<!-- not-run: Allure's environment -->

```js
// jest.config.js
module.exports = {
  testEnvironment: 'allure-jest/node',
  testEnvironmentOptions: {
    resultsDir: 'allure-results',
    links: { issue: { urlTemplate: 'https://jira.example.com/browse/%s' } },
  },
};
```

### Settings

| Allure                    | Probara                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `resultsDir`              | Nothing: results go to Probara. A [results file](results-file.md) keeps what could not be sent              |
| `links.issue.urlTemplate` | `issueUrlTemplate` (`PROBARA_ISSUE_URL_TEMPLATE`) ([`issueUrlTemplate`](configuration.md#issueurltemplate)) |
| `environmentInfo`         | `run.environment` (a name) and the run source, detected from the CI ([runs](runs.md))                       |
| `ALLURE_TESTPLAN_PATH`    | `runCasesOnly` with `PROBARA_RUN_ULID` ([run selection](run-selection.md))                                  |

### Calls

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
| `attachment(name, content, type)`                | `attach({ name, body: content, contentType: type })`                           |
| `attachmentPath(name, path)`                     | `attach({ name, path })`                                                       |
| `link(url, name)`                                | `link(url, name)` ([links](links.md))                                          |
| `issue('PAY-7')`                                 | `issue('PAY-7')`, with `issueUrlTemplate`                                      |
| `tms('12')`                                      | `id('SHOP-12')`                                                                |

<!-- project: allure-after -->

```js
reporters: [
  'default',
  ['@probara/jest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
],
```

<!-- project: allure-after -->

```js
// tests/payments.test.js
const { probara } = require('@probara/jest-reporter');

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
    "automationKey": "tests/payments.test.js > refunds an order",
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

| Topic                               | Allure                                                                        | Probara                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Statuses                            | `failed` for an assertion, `broken` for any other error                       | `failed` for both, with the error in the notes: no guess from the error's type ([statuses](statuses.md))                  |
| A failing `afterEach` or `afterAll` | The test stays passed; only the hook's fixture is broken                      | Jest's verdict: a failing `afterEach` fails its test, a failing `afterAll` adds a failed result for the file              |
| A test plan                         | Excluded tests still run, hooks included, and are only left out of the report | `runCasesOnly` skips them before they run, and does not report them                                                       |
| Attachments                         | Each one wrapped in a step of its own                                         | On the result, or on the step they were attached in                                                                       |
| Retries and history                 | One result file per attempt; the report generator groups them                 | Every attempt is a result of the run; the case keeps its history across runs                                              |
| Watch mode                          | Result files pile up in `resultsDir`                                          | One run for the whole session ([watch mode](watch.md))                                                                    |
| Case fields                         | Labels on every result                                                        | Fields and tags of the case a report creates; an existing case keeps its own ([metadata](metadata.md#created-cases-only)) |

### Not ported

| Allure                                     | Why                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testCaseId()`, `historyId()`              | The key comes from the file and the names, the same as `probara import junit`'s; link a case by its id instead                                    |
| Setup and teardown fixtures from hooks     | Hooks are how a test runs, not what it specifies; wrap what matters in `probara.step()`                                                           |
| `broken` status                            | A guess from the error's type; Probara keeps four statuses and the whole error                                                                    |
| `categories`, known, muted and flaky flags | Triage lives in Probara, on the results and defects; every attempt is a result, so flakiness shows in the history                                 |
| `owner()`                                  | A Probara case has no owner field; assign failed results instead ([assign failed results](assign-failed.md))                                      |
| Masked, hidden and excluded parameters     | Parameters are shown with the result and never part of the key: leave a secret out rather than masking it                                         |
| `logStep()` with a failed or broken status | A step's status is what its body did: a step that throws fails                                                                                    |
| `globalAttachment()`, `globalError()`      | Files and errors belong to a result; attach from the test that produced them                                                                      |
| `descriptionHtml()`                        | The description is text; Probara formats it                                                                                                       |
| `listeners`                                | No hook changes a result before it is sent; `statusMapping` and `statusFilter` cover statuses ([statuses](statuses.md#status-mapping-and-filter)) |
| `ALLURE_LABEL_*` global labels             | Tag the run with `run.tags` instead; case tags come from `probara.tags()` in the test                                                             |

## TestRail

TestRail has no Jest reporter: a pipeline writes JUnit XML with jest-junit, then TestRail's Python
CLI `trcli parse_junit` sends it after the run. The reporter replaces both steps, and sends what
jest-junit cannot write: steps, files, comments and every attempt.

<!-- not-run: jest-junit and TestRail's trcli -->

```bash
npx jest --ci --reporters=default --reporters=jest-junit
trcli -h https://example.testrail.io --project "Shop" -u ci@example.com -k "$TESTRAIL_KEY" \
  parse_junit --title "Nightly" --case-matcher name -f junit.xml --close-run
```

With the reporter, the test step is enough:

```bash
npx jest --ci
```

### Settings

| trcli                                         | Probara                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `-h` (host), `-u`, `-p`, `-k`                 | `baseUrl` for a self-hosted Probara; `PROBARA_API_TOKEN`                                   |
| `--project` (a name)                          | `projectId` (`PROBARA_PROJECT`), the project code                                          |
| `--title`, `--run-description`                | `run.name`, `run.description`                                                              |
| `--run-id`                                    | `run.ulid` (`PROBARA_RUN_ULID`)                                                            |
| `--plan-id`, `--config-ids`, `--milestone-id` | `run.plan`, `run.configurations`, `run.milestone`, by display id or name ([runs](runs.md)) |
| `--close-run`                                 | The default for a run the reporter creates; `closeRun` for a reused one                    |
| `--case-matcher name` (`C123` in the name)    | `SHOP-12` in the title or a `describe` ([linking](linking.md))                             |
| `--case-matcher auto` (`classname.name`)      | The automation key: file, describes and title                                              |
| `-y` (create sections and cases)              | `createMissingCases`, on by default; suites from the test file                             |
| `--suite-id`, `--section-id`                  | `suiteUlid` (`PROBARA_SUITE_ULID`): the suite created cases go under                       |
| `--case-fields type_id:3`                     | `probara.fields({ type: 'Regression' })` in the test, by name ([metadata](metadata.md))    |
| `-a`, `--assign` (emails)                     | `assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO`) ([assign failed results](assign-failed.md))  |
| `-b`, `--batch-size`                          | `chunkSize` (1 to 500)                                                                     |
| `-t`, `--timeout` (seconds, per request)      | `timeoutMs` (milliseconds, per request)                                                    |
| `--proxy`, `--noproxy`                        | `HTTPS_PROXY` and `NO_PROXY` with `NODE_USE_ENV_PROXY=1` ([network](network.md#proxies))   |
| `-v` (verbose)                                | `debug` (`PROBARA_DEBUG`)                                                                  |
| `testrail_result_comment` property            | `probara.comment()`                                                                        |
| `testrail_attachment` property                | `probara.attach()`                                                                         |
| `testrail_result_step` property               | `probara.step()`                                                                           |

jest-junit writes no testcase properties, so the last three rows were out of reach from Jest
before: the helpers make them possible.

### What works differently

| Topic              | trcli on jest-junit                                    | Probara                                                                                                   |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Skipped tests      | Retest                                                 | Skipped                                                                                                   |
| `test.todo`        | Passed (jest-junit writes it as passed)                | Skipped, with the note `Todo`                                                                             |
| Retries            | The last attempt only                                  | Every attempt ([retries](retries.md))                                                                     |
| Nested describes   | Not supported: one section per test suite              | The suite of a created case is its file; `probara.suite()` names nested suites                            |
| Durations          | Rounded to seconds (`--allow-ms` for milliseconds)     | Milliseconds, and the start of each attempt                                                               |
| An unknown case id | Aborts the upload                                      | That result is not recorded, and the log names it; the others are                                         |
| A failed upload    | Rolls back the run, cases and sections it created      | Nothing is rolled back; a [results file](results-file.md) keeps what was not sent                         |
| Shards             | `add_run -f run.yml`, then `-c run.yml` in every shard | `probara run create`, `PROBARA_RUN_ULID` in every shard, `probara run close` ([sharding](ci/sharding.md)) |

### Not ported

| trcli                                                            | Why                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `--update-existing-cases`, `--update-strategy`, `refs`           | A report never changes an existing case: people own what is written there ([created cases only](metadata.md#created-cases-only)) |
| `custom_automation_id` override                                  | The key comes from the file and the names, the same as `probara import junit`'s; link a case by its id instead                   |
| `--result-fields`, `testrail_result_field`                       | Probara results have no custom fields: parameters (`probara.parameters()`) and links (`probara.link()`) carry the extra data     |
| `--test-run-ref`                                                 | The run records its CI build URL, branch and commit; issues link from results (`probara.issue()`)                                |
| `--insecure`                                                     | TLS verification cannot be turned off; give Node your certificate authority instead ([network](network.md))                      |
| The `bdd`, `multisuite` and `saucectl` parsers, `quality_rating` | Jest has no Gherkin scenarios; a run spans one project, and [`projects`](projects.md#several-probara-projects) splits by case id |
| Rollback on failure                                              | A result recorded is kept: rolling back would lose the ones that went through                                                    |

## See also

- [Configuration](configuration.md): every option.
- [Migrating from Qase](migrating-from-qase.md).
- [Migrating from the JUnit import](migrating-from-junit.md).
