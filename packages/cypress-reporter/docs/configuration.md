# Configuration

Every setting is an option of the reporter in the Cypress config, and most have a `PROBARA_*`
variable too. Keep the token in the environment, the project in the config (or the environment),
and set the rest where it fits your pipeline.

## Registration

`@probara/cypress-reporter` registers in two places, and both are needed for the full feature set:

```js
// cypress.config.js
const { defineConfig } = require('cypress');
const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP' },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

```js
// cypress/support/e2e.js
require('@probara/cypress-reporter/support'); // or: import '@probara/cypress-reporter/support'
```

| Registration                                           | What it is                                       | What it turns on                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `reporter` + `reporterOptions`                         | The Mocha reporter Cypress builds for every spec | Every test event: one result per attempt, the keys, the screenshots of each attempt                                                |
| `setupNodeEvents` (`@probara/cypress-reporter/setup`)  | The plugin, in the process that loads the config | The Probara run (created, completed and closed at `after:run`), the `probara` task, the spec video, and the browser as a parameter |
| the support file (`@probara/cypress-reporter/support`) | The browser side, in the spec frame              | The `probara.*` helpers, `captureOutput` and the run selection                                                                     |

The reporter reports every test of every spec, whatever the settings. The plugin owns the run and
what only the plugin can do; the support file turns on what only the browser can do.

**Each one can be missing, and each has its own consequence** (measured in a real `cypress run`):

| What is missing                     | What happens                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing else (all three registered) | Everything: one run for the whole `cypress run`, closed at the end, with the screenshots of every failed attempt, the video, and the `probara.*` helpers                                                                                        |
| `setupNodeEvents`                   | Every result is still sent, but **one run per spec**, each closed as its spec ends: a run with several specs produces several runs. No screenshot, no video, and no `probara` task, so no `probara.*` helper. One warning names what is missing |
| The support file                    | Results, screenshots and the video as usual. Every `probara.*` call does nothing, `captureOutput` captures nothing, the run selection skips nothing, and one line on the browser console says why                                               |
| The reporter (only the plugin)      | Nothing is reported at all: Cypress never builds this reporter, so nothing reports itself                                                                                                                                                       |

The plugin reads the same `reporterOptions` Cypress hands the reporter, so it needs no settings of
its own; return its config from `setupNodeEvents`, as `probaraNodeEvents(on, config)` does.

`reporterOptions` takes the plain object above. The reporter also accepts the wrapper
`cypress-multi-reporters` uses (`{ '@probara/cypress-reporter': { ... } }`) and unwraps it, but the
plugin reads `config.reporterOptions` as Cypress hands it: keep the plain object when you register
the plugin, or the plugin resolves no options of its own.

## Quick path

1. Create an app token from the **Cypress** card in **Integrations** ([get a token](#get-a-token))
   and store it as a CI secret named `PROBARA_API_TOKEN`.
2. Set the project code: `projectId` in `reporterOptions`, or `PROBARA_PROJECT`. A project code is
   a capital letter, then capital letters or digits (`SHOP`, `E2E`): any other value turns reporting
   off with an error.
3. Everything else has a default. The run is named after the CI build, and its branch, commit and
   build URL come from the CI on their own.

## Get a token

Report with an app token. It belongs to your organization, not to a person:

1. As an admin or owner, open **Workspace › Integrations** in Probara and pick the **Cypress** card.
2. Enter a **Token name** after what uses it (the repository or the pipeline) and select
   **Create token**.
3. Select **Copy token**. It is shown once: store it as the CI secret `PROBARA_API_TOKEN` right away.

What an app token is:

- It uses no seat, and it keeps working when the person who created it leaves the organization.
- Its runs and results show the app and the token's name (such as **Cypress · shop-e2e**), not a
  person.
- It can only report: create automated runs, send reports (which can create cases and suites),
  upload result attachments, close runs, and read the case keys of a run (for
  [`runCasesOnly`](#runcasesonly)). It cannot read anything else. The
  [`probara` CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md) takes
  the same token for `run create` and `run close`.
- Revoke it from the same card when it may have leaked, then create a new one.

Reporting from CI needs a paid plan: on the free plan, Probara answers `403 forbidden`. The
[Cypress integration guide](https://docs.probara.net/en/guides/integrations/cypress/) covers the
card in detail.

Do not put the token in the Cypress config: the config is committed. `apiToken` exists for code
that reads the token from its own secret store.

## Sources and precedence

The first source that sets a value wins:

| Order | Source                                          | Example                                   |
| ----- | ----------------------------------------------- | ----------------------------------------- |
| 1     | An option of the reporter in the Cypress config | `{ run: { name: 'Release 2.4' } }`        |
| 2     | A `PROBARA_*` variable                          | `PROBARA_RUN_NAME=Nightly`                |
| 3     | CI detection                                    | `CI #42` from the workflow and run number |
| 4     | The default                                     | `Automated run 2026-09-29 14:05 UTC`      |

- An option set to `undefined` never hides its variable, and a blank variable counts as unset. To
  let a variable override an option, leave the option out (or pass `process.env.X ?? default`).
- Booleans accept `true`, `1`, `yes`, `on` and `false`, `0`, `no`, `off`. Lists are
  comma-separated in variables (`PROBARA_RUN_TAGS=nightly,smoke`).
- CI detection reads the provider's own variables, the same as for every other reporter
  ([CI detection](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

Options and variables can be mixed. This config sets the project and tags:

```js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', run: { tags: ['unit', 'nightly'] } },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

and the pipeline adds the run's environment and name:

```bash
PROBARA_ENVIRONMENT=staging PROBARA_RUN_NAME=Nightly npx cypress run
```

## Options

<!-- options-table -->

Every option of [`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md)
under the same name, plus the seven a Cypress run adds:

| Option                   | Variable                       | Type                                    | Default                                        | What it does                                                                                                      |
| ------------------------ | ------------------------------ | --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`                | `PROBARA_ENABLED`              | `boolean`                               | on                                             | `false` turns reporting off: nothing is sent, and nothing is logged                                               |
| `apiToken`               | `PROBARA_API_TOKEN`            | `string`                                | none (required)                                | The app token. Keep it in the environment                                                                         |
| `projectId`              | `PROBARA_PROJECT`              | `string`                                | none (required)                                | The project code (capital letters and digits), such as `SHOP`                                                     |
| `baseUrl`                | `PROBARA_BASE_URL`             | `string`                                | `https://app.probara.net`                      | The Probara to report to ([self-hosted](#self-hosted-probara))                                                    |
| `run.ulid`               | `PROBARA_RUN_ULID`             | `string`                                | none: a new run                                | Report into an existing run ([run options](runs.md))                                                              |
| `run.name`               | `PROBARA_RUN_NAME`             | `string`                                | the CI build name, else `Automated run <date>` | Name of a new run                                                                                                 |
| `run.description`        | `PROBARA_RUN_DESCRIPTION`      | `string`                                | none                                           | Description of a new run                                                                                          |
| `run.environment`        | `PROBARA_ENVIRONMENT`          | `string`                                | none                                           | Environment of a new run by name, created when none matches                                                       |
| `run.environmentId`      | `PROBARA_ENVIRONMENT_ID`       | `string`                                | none                                           | Environment of a new run by ULID                                                                                  |
| `run.milestone`          | `PROBARA_MILESTONE`            | `string`                                | none                                           | Milestone of a new run by display id (`M-3`) or name                                                              |
| `run.milestoneId`        | `PROBARA_MILESTONE_ID`         | `string`                                | none                                           | Milestone of a new run by ULID                                                                                    |
| `run.plan`               | `PROBARA_PLAN`                 | `string`                                | none                                           | Test plan of a new run by display id (`PLAN-2`) or name: the run starts with its cases                            |
| `run.configurations`     | `PROBARA_CONFIGURATIONS`       | `{ group, name }[]`                     | none                                           | Configurations of a new run by name (`Browser=Chrome,OS=Linux`), each group once                                  |
| `run.configurationUlids` | `PROBARA_CONFIGURATION_ULIDS`  | `string[]`                              | none                                           | Configurations of a new run by ULID                                                                               |
| `run.tags`               | `PROBARA_RUN_TAGS`             | `string[]`                              | none                                           | Tags of a new run                                                                                                 |
| `run.ulids`              | `PROBARA_RUN_ULIDS`            | `Record<string, string>`                | none                                           | The run to reuse in each project (`WEB=<ulid>,API=<ulid>`) ([projects](projects.md#several-probara-projects))     |
| `projects`               | `PROBARA_PROJECTS`             | `string[]`                              | none                                           | Other projects results may go to (`WEB,API`) ([projects](projects.md#several-probara-projects))                   |
| `source`                 | —                              | `false \| { branch, commit, buildUrl }` | detected from the CI                           | `false` sends no source; an object overrides the detected fields one by one                                       |
| `source.branch`          | `PROBARA_BRANCH`               | `string`                                | detected from the CI                           | Branch of the run source                                                                                          |
| `source.commit`          | `PROBARA_COMMIT`               | `string`                                | detected from the CI                           | Commit of the run source                                                                                          |
| `source.buildUrl`        | `PROBARA_BUILD_URL`            | `string`                                | detected from the CI                           | CI build URL of the run source                                                                                    |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES` | `boolean`                               | `true`                                         | Create a case for a test that matches none                                                                        |
| `suiteUlid`              | `PROBARA_SUITE_ULID`           | `string`                                | the project root                               | Suite that created cases go under                                                                                 |
| `closeRun`               | `PROBARA_CLOSE_RUN`            | `boolean`                               | `true` for a new run, `false` for a reused one | Close the run at the end (never in `cypress open`, never for a reused run unless set)                             |
| `closeRuns`              | —                              | `Record<string, boolean>`               | none                                           | Close the run of each project (`{ SHOP: true, WEB: false }`) when `closeRun` is not set                           |
| `uploadAttachments`      | `PROBARA_UPLOAD_ATTACHMENTS`   | `boolean`                               | `true`                                         | `false` uploads no file                                                                                           |
| `keyIncludesFile`        | `PROBARA_KEY_INCLUDES_FILE`    | `boolean`                               | `true`                                         | Start each automation key with the spec file ([`keyIncludesFile`](#keyincludesfile))                              |
| `captureOutput`          | `PROBARA_CAPTURE_OUTPUT`       | `boolean`                               | `false`                                        | Attach each attempt's console output ([`captureOutput`](#captureoutput))                                          |
| `attachScreenshots`      | `PROBARA_ATTACH_SCREENSHOTS`   | `boolean`                               | `true`                                         | Attach the screenshot of each failed attempt ([`attachScreenshots`](#attachscreenshots))                          |
| `attachVideos`           | `PROBARA_ATTACH_VIDEOS`        | `boolean`                               | `false`                                        | Attach the video of a spec to its failed results ([`attachVideos`](#attachvideos))                                |
| `browserAsParameter`     | `PROBARA_BROWSER_AS_PARAMETER` | `boolean`                               | `true`                                         | Send the browser Cypress runs as a `browser` parameter ([`browserAsParameter`](#browserasparameter))              |
| `issueUrlTemplate`       | `PROBARA_ISSUE_URL_TEMPLATE`   | `string`                                | none                                           | The URL each `probara.issue(id)` becomes, with `%s` for the id ([`issueUrlTemplate`](#issueurltemplate))          |
| `runCasesOnly`           | `PROBARA_RUN_CASES_ONLY`       | `boolean`                               | `false`                                        | Run only the tests of the cases of `run.ulid` ([`runCasesOnly`](#runcasesonly))                                   |
| `statusMapping`          | `PROBARA_STATUS_MAPPING`       | `{ passed, failed, skipped, blocked }`  | none                                           | Send a status as another (`failed=blocked`) ([status rules](#status-mapping-and-filter))                          |
| `statusFilter`           | `PROBARA_STATUS_FILTER`        | `string[]`                              | none                                           | Send no result with these statuses, after the mapping (`skipped`)                                                 |
| `resultsFile`            | `PROBARA_RESULTS_FILE`         | `string`                                | none                                           | JSON file for what could not be sent ([results file](#results-file))                                              |
| `assignFailedTo`         | `PROBARA_ASSIGN_FAILED_TO`     | `string[]`                              | none                                           | Assign each failed result without an assignee to one of these members, in turn (`ana@example.com,bo@example.com`) |
| `debug`                  | `PROBARA_DEBUG`                | `boolean`                               | `false`                                        | Log every request ([debug](#debug))                                                                               |
| `rootDir`                | —                              | `string`                                | Cypress's `projectRoot`                        | Directory the spec paths of automation keys are relative to                                                       |
| `clientName`             | —                              | `string`                                | `probara-cypress-reporter/<version>`           | Sent in the `User-Agent`; the reporter always sends its own                                                       |
| `chunkSize`              | —                              | `number`                                | `500`                                          | Results per report request, 1 to 500                                                                              |
| `timeoutMs`              | —                              | `number`                                | `30000`                                        | Timeout of one HTTP attempt, in milliseconds, 1 to 600000                                                         |
| `maxRetries`             | —                              | `number`                                | `4`                                            | Retries of a failed request, 0 to 10                                                                              |
| `attachmentConcurrency`  | —                              | `number`                                | `2`                                            | Results whose attachments upload at the same time, 1 to 8                                                         |

For code and tests, the reporter also takes the seams of `@probara/core`. They have no variable, and
a Cypress config rarely needs them:

<!-- runtime-options-table -->

| Option   | Variable | Type                           | Default                     | What it does                                             |
| -------- | -------- | ------------------------------ | --------------------------- | -------------------------------------------------------- |
| `logger` | —        | `{ debug, info, warn, error }` | `[probara]` lines on stderr | Where the reporter logs                                  |
| `env`    | —        | `Record<string, string>`       | `process.env`               | Where `PROBARA_*` and CI variables are read from         |
| `fetch`  | —        | `function`                     | the global `fetch`          | The HTTP client                                          |
| `sleep`  | —        | `function`                     | `setTimeout`                | Waits between retries                                    |
| `random` | —        | `function`                     | `Math.random`               | Jitter of the retry backoff                              |
| `now`    | —        | `function`                     | the current time            | Clock of the default run name and of `Retry-After` dates |

An option the reporter does not know is left out with a warning, and reporting goes on:

<!-- project: unknown-option -->

```js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', captureOutputs: true },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

<!-- output: unknown-option -->

```text
$ npx cypress run
[probara] Ignored the unknown option "captureOutputs" of @probara/cypress-reporter
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Settings of the Cypress reporter

### `keyIncludesFile`

Each test is matched to its case by an automation key: the **spec file** relative to `rootDir`
(Cypress's `projectRoot`), then `>` between spaces, then the full title of the test (its `describe`
titles and its own title, joined by single spaces, which is the name cypress-junit writes), without
the case ids of the titles:

```text
cypress/e2e/cart.cy.js > Cart SHOP-12 adds an item   ← what a title with a case id produces
cypress/e2e/cart.cy.js > Cart adds an item
```

The case ids of `projectId` and of `projects` are read out of the titles and link the test to those
cases; every other id stays in the title and in the key. A test of one spec with the same describes
and title as a test of another spec is one case as long as the file is part of the key.

`keyIncludesFile: false` leaves the file out, like a JUnit report written without the `file`
attribute of the root suite: switch to it when your cases were imported from such reports, so each
test keeps its case. A test then gets the same key as a test with the same describes and title in
another spec, and the spec leaves the case's suite path as well.

```text
Cart adds an item
Login logs in with a valid password
```

Changing `keyIncludesFile` changes every key: tests that name no case in their titles then create
new cases. A case the report creates goes in a suite named after the spec and its describes
([specs](specs.md#the-spec-as-the-suite-of-a-case)), or after its outermost describe with
`keyIncludesFile: false`.

Cypress's own folder options never reach the key: the spec path is relative to `projectRoot`, not
to the spec, and `--spec` never changes it.

### `captureOutput`

```json
{ "captureOutput": true }
```

With it on, the support file wraps `console.log`, `console.info` and `console.debug` (stdout) and
`console.warn` and `console.error` (stderr) for the time of each test. What the test wrote is
attached to that test's result as `stdout.log` and `stderr.log` (`text/plain`), one file per stream
per test, cut at 32 MiB with a line saying so. The browser console still prints everything,
captured or not.

The capture is installed by the support file and its output travels with the rest of what the
helpers say, so it needs that file: without it nothing is captured and `captureOutput` has no
effect. What is not captured: `console.table`, `console.dir` and the other console methods the five
above do not cover, a console method a test replaced, and anything a test wrote outside a test
([attachments](attachments.md#console-output)).

### `attachScreenshots`

`attachScreenshots: true` (the default) attaches the screenshot Cypress took of a failed attempt to
the result of **that** attempt, as an `image/png`. Cypress names a screenshot after the test it took
it for (`<titles joined by ' -- '> (failed)`, plus ` (attempt N)` for a retry), so no guessing is
needed, and a screenshot that names no failed test of the spec is left out and named once at debug
([screenshots](specs.md#the-screenshots-of-a-failure)).

It needs the plugin: Cypress announces each screenshot with `after:screenshot`, which only
`setupNodeEvents` receives. With `attachScreenshots: false` none is attached and Cypress still takes
them where it always does.

### `attachVideos`

`attachVideos: true` attaches the video of a spec to **every failed result of that spec** (a
blocked one too), under the name of the spec file, as a `video/mp4`. It needs `video: true` in the
Cypress config and the plugin, which is what receives the video with `after:spec`.

The default is off, and the cost is why: one upload per failed result, and video files are large
([the video of a spec](specs.md#the-video-of-a-spec)).

### `browserAsParameter`

`browserAsParameter: true` (the default) sends the name of the browser Cypress runs (`electron`,
`chrome`, `firefox`, `edge`) as a `browser` parameter of every result:

```json
{
  "automationKey": "cypress/e2e/cart.cy.js > Cart adds an item",
  "parameters": { "browser": "electron" }
}
```

It never enters the key: a JUnit report has no browser either, and the key has to be the one the
import gives ([links](linking.md#automation-keys)). The browser is announced by the plugin with
`before:run`, so without the plugin there is no browser name and no parameter.

The second parameter the reporter adds is the attempt number, from the second attempt of a test on
([retries](retries.md)).

### `issueUrlTemplate`

`probara.issue(id)` names an issue of your tracker: `issueUrlTemplate` turns it into a link of the
result, named by the id, with the URL-encoded id in place of `%s`. Without a template, issues are
left out with a warning.

<!-- project: issues -->

```js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: {
      projectId: 'SHOP',
      issueUrlTemplate: 'https://jira.example.com/browse/%s',
    },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

<!-- project: issues -->

```js
// cypress/e2e/checkout.cy.js
it('pays by card', () => {
  probara.issue('PAY-7');
  cy.get('.pay').click();
});
```

<!-- sent: issues -->

```json
[
  {
    "automationKey": "cypress/e2e/checkout.cy.js > pays by card",
    "links": [{ "url": "https://jira.example.com/browse/PAY-7", "name": "PAY-7" }]
  }
]
```

The template is an `http` or `https` URL with `%s`; any other value turns reporting off with an
error.

### `runCasesOnly`

`runCasesOnly: true` (or `PROBARA_RUN_CASES_ONLY=true`) runs only the tests of the cases of the run
`run.ulid` (`PROBARA_RUN_ULID`), and reports into that run, leaving it open. A test belongs to the
run when its automation key is the key of one of its cases, or when its title or one of its
`describe` blocks names one of its cases (`SHOP-12`). A `probara.id()` call does not count: it runs
with the test, after the selection.

```bash
PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx cypress run
```

It needs both other registrations: the plugin (which reads the run's cases once and answers the
browser per test) and the support file (which skips a test the answer excluded, in a
`beforeEach`). Without either, every test runs and is reported, with one warning naming what was
missing. Cypress decides `it.skip` while the spec loads, so a test that is not in the selection
still runs the module scope of its file.

Run selection is [its own page](run-selection.md).

## Runs

### Run references

A new run takes its name, description, environment, milestone, test plan, configurations and tags
from the `run.*` options (or their variables). Environments, milestones, plans and configurations
are named as Probara shows them; an environment that matches none is created.

`run.ulid` (`PROBARA_RUN_ULID`) reports into an existing run instead, such as one
`probara run create` made for every shard of a CI job; the reporter never closes a run it did not
create, unless `closeRun` says so. A `cypress open` session creates one run for the whole session,
reports every spec into it, and never closes it: it logs the `probara run close` command that closes
it ([interactive mode](watch.md), [sharding](ci/sharding.md), [run options](runs.md)).

### Several Probara projects

A test whose title names a case of another project (`WEB-7 renders the cart`) goes to that project
when `projects` lists it (`projects: ['WEB']`, `PROBARA_PROJECTS=WEB`): each project gets its own
run, or the one `run.ulids` names (`PROBARA_RUN_ULIDS=WEB=<ulid>`). Case ids are read from titles
only for `projectId` and `projects`: `API-7` of an unlisted project stays in the title and the key,
and the test goes to `projectId` ([projects](projects.md#several-probara-projects)).

## Status mapping and filter

Each attempt is `passed`, `failed` or `skipped`, from Cypress' own verdict: `pass` is passed, `fail`
and a `retry` are failed, `pending` is skipped. `statusMapping` sends a status as another
(`{ failed: 'blocked' }`, `PROBARA_STATUS_MAPPING=failed=blocked`), and `statusFilter` sends no
result with the listed statuses, after the mapping (`['failed']`, `PROBARA_STATUS_FILTER=failed`).

The `Sending` line says what each of them did:

```text
[probara] Sending 4 results of 4 tests (3 passed, 0 failed, 1 skipped, 0 blocked); 1 left out by statusFilter
```

A skipped result left out by the filter is not sent, and the count is in the line
([statuses](statuses.md)).

## Assign failed results

`assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO=ana@example.com,bo@example.com`) assigns each failed
result to one of the listed members, in turn, when its run case has no assignee yet. An email that
matches no member who can work in the project is skipped, and Probara's warning says how many were
([assign failed results](assign-failed.md)).

## Results file

`resultsFile` (`PROBARA_RESULTS_FILE`, relative to the directory `cypress run` was started in) keeps
what could not be sent, such as when Probara refuses the token, in a JSON file, with the files the
results attach in `<name>-attachments/` next to it; `probara import results` sends it later, into
the same runs. The file is written only when something was not sent, and never over an earlier
file: the reporter then writes to the first free sibling (`probara-results-2.json`).

```js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', resultsFile: 'results/probara-results.json' },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

With reporting off (`enabled: false`, or no token), every result goes to the file, so a job can run
the tests and another job, which holds the token, send them:

```bash
PROBARA_ENABLED=false PROBARA_RESULTS_FILE=probara-results.json npx cypress run
npx @probara/cli import results 'probara-results*.json'
```

Quote the glob: `probara` expands it, and it matches the file and its siblings
([results file](results-file.md)).

## Debug

`debug: true` (`PROBARA_DEBUG=true`) adds a line for every request (method, path, status, time) and
every retry, and says why reporting is off when it is. Keep it off in normal runs: it is verbose,
though it never logs the token or the bodies ([debugging](debugging.md)).

```bash
PROBARA_DEBUG=true npx cypress run
```

The reporter logs on stderr, because stdout belongs to Cypress' own output: `[probara]` lines never
appear among the test output. The reporter's own process does not reach the console of a `cypress
run` at all; its warnings travel to the plugin and are logged there
([troubleshooting](troubleshooting.md#two-processes-one-run)).

## What happens with each setup

| Setup                                        | What the reporter does                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| No token and no project, or `enabled: false` | Stays off and quiet: nothing is sent, and nothing is logged (but at debug). |
| Only one of them, or an invalid value        | Reporting is off; each problem is logged, and the tests run as usual.       |
| A token and a project, every value valid     | Reports.                                                                    |

A value of the wrong type (such as `run.tags: 'nightly'` instead of a list) is an invalid value:

<!-- project: invalid, reports: none -->

```js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', run: { tags: 'nightly' } },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

<!-- output: invalid -->

```text
$ npx cypress run
[probara] Probara reporting is off: run.tags must be a list of strings
```

Problems name the option or the variable at fault, never its value, so a token never shows up.

## Turn reporting off

Set `enabled: false` or `PROBARA_ENABLED=false`, or leave the token out: the reporter sends nothing
and stays quiet. Builds of pull requests from forks get no secrets, so they report nothing on their
own. To keep what a run could not send, even with reporting off, set a
[results file](#results-file).

## Self-hosted Probara

Point the reporter at another Probara with `baseUrl` or `PROBARA_BASE_URL`: the URL of the app,
without a path. Requests go to that host and nowhere else; proxies and private certificate
authorities are in [network](network.md).

## See also

- [Specs](specs.md): what a spec contributes to a result.
- [Status](statuses.md): how every outcome becomes a status.
- [Troubleshooting](troubleshooting.md): problems and every line the reporter logs.
