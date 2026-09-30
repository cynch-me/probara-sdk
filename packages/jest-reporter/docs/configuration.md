# Configuration

Every setting is an option of the reporter in the Jest config, and most have a `PROBARA_*` variable
too. Keep the token in the environment, the project in the config (or the environment), and set
the rest where it fits your pipeline.

## Quick path

1. Create an app token from the **Jest** card in **Integrations** ([get a token](#get-a-token)) and
   store it as a CI secret named `PROBARA_API_TOKEN`.
2. Set the project code: `projectId` in the reporter options, or `PROBARA_PROJECT`. A project code
   is a capital letter, then capital letters or digits (`SHOP`, `E2E`): any other value turns
   reporting off with an error.
3. Everything else has a default. The run is named after the CI build, and its branch, commit and
   build URL come from the CI on their own.

```js
// jest.config.js
module.exports = {
  reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
};
```

Jest reads its config from `jest.config.js`, `jest.config.mjs`, `jest.config.cjs` or the `jest`
key of `package.json`; the reporter entry is the same in each. In `package.json`:

<!-- project: package-json -->

```json
// package.json
{
  "private": true,
  "jest": {
    "reporters": ["default", ["@probara/jest-reporter", { "projectId": "SHOP" }]]
  }
}
```

## Get a token

Report with an app token. It belongs to your organization, not to a person:

1. As an admin or owner, open **Workspace › Integrations** in Probara and pick the **Jest** card.
2. Enter a **Token name** after what uses it (the repository or the pipeline) and select
   **Create token**.
3. Select **Copy token**. It is shown once: store it as the CI secret `PROBARA_API_TOKEN` right away.

What an app token is:

- It uses no seat, and it keeps working when the person who created it leaves the organization.
- Its runs and results show the app and the token's name (such as **Jest · unit-ci**), not a
  person.
- It can only report: create automated runs, send reports (which can create cases and suites),
  upload result attachments, close runs, and read the case keys of a run (for
  [`runCasesOnly`](#runcasesonly)). It cannot read anything else. The
  [`probara` CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md) takes the
  same token for `run create` and `run close`.
- Revoke it from the same card when it may have leaked, then create a new one.

Reporting from CI needs a paid plan: on the free plan, Probara answers `403 forbidden`. The
[Jest integration guide](https://docs.probara.net/en/guides/integrations/jest/) covers the card in
detail.

Do not put the token in the Jest config: the config is committed. `apiToken` exists for code that
reads the token from its own secret store.

## Sources and precedence

The first source that sets a value wins:

| Order | Source                                       | Example                                   |
| ----- | -------------------------------------------- | ----------------------------------------- |
| 1     | An option of the reporter in the Jest config | `{ run: { name: 'Release 2.4' } }`        |
| 2     | A `PROBARA_*` variable                       | `PROBARA_RUN_NAME=Nightly`                |
| 3     | CI detection                                 | `CI #42` from the workflow and run number |
| 4     | The default                                  | `Automated run 2026-09-29 14:05 UTC`      |

- An option set to `undefined` never hides its variable, and a blank variable counts as unset. To
  let a variable override an option, leave the option out (or pass `process.env.X ?? default`).
- Booleans accept `true`, `1`, `yes`, `on` and `false`, `0`, `no`, `off`. Lists are
  comma-separated in variables (`PROBARA_RUN_TAGS=nightly,smoke`).
- CI detection only fills the run's name and its source (branch, commit, build URL):
  [what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection).

Options and variables can be mixed. This config sets the project and tags:

```js
reporters: [
  'default',
  ['@probara/jest-reporter', { projectId: 'SHOP', run: { tags: ['unit', 'nightly'] } }],
],
```

and the pipeline adds the run's environment and name:

```bash
PROBARA_ENVIRONMENT=staging PROBARA_RUN_NAME=Nightly npx jest
```

## Options

<!-- options-table -->

| Option                   | Variable                       | Type                                    | Default                                        | What it does                                                                                                      |
| ------------------------ | ------------------------------ | --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`                | `PROBARA_ENABLED`              | `boolean`                               | on                                             | `false` turns reporting off: nothing is sent, and nothing is logged                                               |
| `apiToken`               | `PROBARA_API_TOKEN`            | `string`                                | none (required)                                | The app token. Keep it in the environment                                                                         |
| `projectId`              | `PROBARA_PROJECT`              | `string`                                | none (required)                                | The project code (capital letters and digits), such as `SHOP`                                                     |
| `baseUrl`                | `PROBARA_BASE_URL`             | `string`                                | `https://app.probara.net`                      | The Probara to report to ([self-hosted](#self-hosted-probara))                                                    |
| `run.ulid`               | `PROBARA_RUN_ULID`             | `string`                                | none: a new run                                | Report into an existing run ([run references](#run-references))                                                   |
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
| `run.ulids`              | `PROBARA_RUN_ULIDS`            | `Record<string, string>`                | none                                           | The run to reuse in each project (`WEB=<ulid>,API=<ulid>`) ([several projects](#several-probara-projects))        |
| `projects`               | `PROBARA_PROJECTS`             | `string[]`                              | none                                           | Other projects results may go to (`WEB,API`) ([several projects](#several-probara-projects))                      |
| `source`                 | —                              | `false \| { branch, commit, buildUrl }` | detected from the CI                           | `false` sends no source; an object overrides the detected fields one by one                                       |
| `source.branch`          | `PROBARA_BRANCH`               | `string`                                | detected from the CI                           | Branch of the run source                                                                                          |
| `source.commit`          | `PROBARA_COMMIT`               | `string`                                | detected from the CI                           | Commit of the run source                                                                                          |
| `source.buildUrl`        | `PROBARA_BUILD_URL`            | `string`                                | detected from the CI                           | CI build URL of the run source                                                                                    |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES` | `boolean`                               | `true`                                         | Create a case for a test that matches none                                                                        |
| `suiteUlid`              | `PROBARA_SUITE_ULID`           | `string`                                | the project root                               | Suite that created cases go under                                                                                 |
| `closeRun`               | `PROBARA_CLOSE_RUN`            | `boolean`                               | `true` for a new run, `false` for a reused one | Close the run at the end (never in watch mode)                                                                    |
| `closeRuns`              | —                              | `Record<string, boolean>`               | none                                           | Close the run of each project (`{ SHOP: true, WEB: false }`) when `closeRun` is not set                           |
| `uploadAttachments`      | `PROBARA_UPLOAD_ATTACHMENTS`   | `boolean`                               | `true`                                         | `false` uploads no file                                                                                           |
| `keyIncludesFile`        | `PROBARA_KEY_INCLUDES_FILE`    | `boolean`                               | `true`                                         | Start each automation key with the test file ([`keyIncludesFile`](#keyincludesfile))                              |
| `captureOutput`          | `PROBARA_CAPTURE_OUTPUT`       | `boolean`                               | `false`                                        | Attach each attempt's console output as `stdout.log` and `stderr.log` ([`captureOutput`](#captureoutput))         |
| `issueUrlTemplate`       | `PROBARA_ISSUE_URL_TEMPLATE`   | `string`                                | none                                           | The URL each `probara.issue(id)` becomes, with `%s` for the id ([`issueUrlTemplate`](#issueurltemplate))          |
| `runCasesOnly`           | `PROBARA_RUN_CASES_ONLY`       | `boolean`                               | `false`                                        | Run only the tests of the cases of `run.ulid` ([`runCasesOnly`](#runcasesonly))                                   |
| `statusMapping`          | `PROBARA_STATUS_MAPPING`       | `{ passed, failed, skipped, blocked }`  | none                                           | Send a status as another (`failed=blocked`) ([status rules](#status-mapping-and-filter))                          |
| `statusFilter`           | `PROBARA_STATUS_FILTER`        | `string[]`                              | none                                           | Send no result with these statuses, after the mapping (`skipped`)                                                 |
| `resultsFile`            | `PROBARA_RESULTS_FILE`         | `string`                                | none                                           | JSON file for what could not be sent ([results file](#results-file))                                              |
| `assignFailedTo`         | `PROBARA_ASSIGN_FAILED_TO`     | `string[]`                              | none                                           | Assign each failed result without an assignee to one of these members, in turn (`ana@example.com,bo@example.com`) |
| `debug`                  | `PROBARA_DEBUG`                | `boolean`                               | `false`                                        | Log every request ([debug](#debug))                                                                               |
| `rootDir`                | —                              | `string`                                | the working directory                          | Directory the file paths of automation keys are relative to ([`keyIncludesFile`](#keyincludesfile))               |
| `chunkSize`              | —                              | `number`                                | `500`                                          | Results per report request, 1 to 500                                                                              |
| `timeoutMs`              | —                              | `number`                                | `30000`                                        | Timeout of one HTTP attempt, in milliseconds, 1 to 600000                                                         |
| `maxRetries`             | —                              | `number`                                | `4`                                            | Retries of a failed request, 0 to 10                                                                              |
| `attachmentConcurrency`  | —                              | `number`                                | `2`                                            | Results whose attachments upload at the same time, 1 to 8                                                         |

The reporter sends its own name and version in the `User-Agent` (such as
`probara-jest-reporter/0.1.0 probara-core/0.1.0 node/22.12.0`); there is no option for it.

For code and tests, the reporter also takes the seams of `@probara/core`. They have no variable,
and a Jest config rarely needs them:

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
reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP', captureOutputs: true }]],
```

<!-- output: unknown-option -->

```text
$ npx jest
[probara] Ignored the unknown option "captureOutputs" of @probara/jest-reporter
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## Settings of the Jest reporter

### `keyIncludesFile`

Each test is matched to its case by an automation key: the test file relative to `rootDir` (the
working directory `jest` runs in, its real path), then the describe blocks and the title, joined
with `>`, without the case ids of the titles. That is the key `probara import junit` gives the
same test on jest-junit's report written with `JEST_JUNIT_ADD_FILE_ATTRIBUTE=true`.

`keyIncludesFile: false` leaves the file out, like jest-junit's report without the file attribute
(its default): switch to it when your cases were imported from such reports, so each test keeps
its case. A test then gets the same key as a test with the same describe blocks and title in
another file.

<!-- project: without-file -->

```js
reporters: ['default', ['@probara/jest-reporter', { keyIncludesFile: false }]],
```

<!-- sent: without-file -->

```json
[
  { "automationKey": "cart adds an item", "caseDisplayId": "SHOP-12" },
  { "automationKey": "cart removes an item" },
  { "automationKey": "login logs in with a valid password" }
]
```

Changing `keyIncludesFile` changes every key: tests that name no case in their titles then create
new cases. A case the report creates goes in a suite named after the test file, or, with
`keyIncludesFile: false`, after its outermost describe block, when it has one.

Jest [`projects`](https://jestjs.io/docs/configuration#projects-arraystring--projectconfig) add
nothing to the key, as with the JUnit import: a test file two projects run is reported once per
project, under the same keys.

### `captureOutput`

`captureOutput: true` attaches what each attempt writes with `console.log`, `console.info` and
`console.debug` as `stdout.log`, and with `console.warn` and `console.error` as `stderr.log`
(`text/plain`), its `beforeEach` and `afterEach` hooks included. Jest still prints the output as
usual. It needs the reporter's setup file, which Jest runs in every test file:

<!-- project: capture -->

```js
reporters: ['default', ['@probara/jest-reporter', { captureOutput: true }]],
setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
```

<!-- project: capture -->

```js
// tests/checkout.test.js
test('pays by card', () => {
  console.log('card accepted');
  console.warn('slow gateway');
});
```

<!-- files: capture -->

```text
stdout.log text/plain
stderr.log text/plain
```

Without the setup file, the tests run and are reported without their output, with one warning:

<!-- project: capture-without-setup -->

```js
reporters: ['default', ['@probara/jest-reporter', { captureOutput: true }]],
```

<!-- project: capture-without-setup -->

```js
// tests/checkout.test.js
test('pays by card', () => {
  console.log('card accepted');
});
```

<!-- output: capture-without-setup -->

```text
$ npx jest
[probara] captureOutput needs the setup file: add setupFilesAfterEnv: ['@probara/jest-reporter/setup'] to the Jest config (first seen in tests/checkout.test.js; repeats are logged at debug)
[probara] Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 1 result (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

Not captured: `console.dir`, `console.table`, `console.group`, `console.count`, `console.time`,
`console.assert`, `process.stdout.write`, the output of `test.concurrent` tests, and a console a
test replaced with a spy or a mock. Each stream is cut at 32 MiB, with a line that says so
([console output](attachments.md#console-output)).

### `issueUrlTemplate`

`probara.issue(id)` names an issue of your tracker: `issueUrlTemplate` turns it into a link of the
result, named by the id, with the URL-encoded id in place of `%s`. Without a template, issues are
left out with a warning.

<!-- project: issues -->

```js
reporters: [
  'default',
  ['@probara/jest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
],
```

<!-- project: issues -->

```js
// tests/checkout.test.js
const { probara } = require('@probara/jest-reporter');

test('pays by card', () => {
  probara.issue('PAY-7');
});
```

<!-- sent: issues -->

```json
[
  {
    "automationKey": "tests/checkout.test.js > pays by card",
    "links": [{ "url": "https://jira.example.com/browse/PAY-7", "name": "PAY-7" }]
  }
]
```

The template is an `http` or `https` URL with `%s`; any other value turns reporting off with an
error.

### `runCasesOnly`

`runCasesOnly: true` (or `PROBARA_RUN_CASES_ONLY=true`) runs only the tests of the cases of the run
`run.ulid` (`PROBARA_RUN_ULID`), and reports into that run, leaving it open. Before the tests
start, the reporter reads the run's case keys; a test belongs to the run when its automation key is
the key of one of its cases, or when its title or one of its describe blocks names one of its cases
(`SHOP-12`). A `probara.id()` call does not count: it runs with the test, after the selection. Jest
skips every other test, and the reporter does not report it.

It needs the setup file and jest-circus, Jest's default test runner. Turn it on in the job that
runs a run's tests, with the variables:

<!-- project: selection -->

```js
reporters: ['default', '@probara/jest-reporter'],
setupFilesAfterEnv: ['@probara/jest-reporter/setup'],
```

<!-- output: selection, scenario: run-cases -->

```text
$ PROBARA_RUN_CASES_ONLY=true PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx jest
[probara] Ran only the tests of run 01J9Z3K4M5N6P7Q8R9S0T1V2W3: 2 of 3 tests match its cases; 1 skipped and not reported
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (0 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

When the run's cases cannot be read, when no run ULID is set, or in a test file the setup file did
not run in, every test runs and is reported, with one warning. Tests are skipped once Jest loaded
their file: a file with no test of the run still runs its module scope and its root
`beforeAll`/`afterAll` hooks. When that is expensive, also pass Jest a path filter
(`npx jest tests/cart`) to leave such files out. [Run selection](run-selection.md) has the
matching rules, what is reported, and every fallback.

## Runs

### Run references

A new run takes its name, description, environment, milestone, test plan, configurations and tags
from the `run.*` options (or their variables). Environments, milestones, plans and configurations
are named as Probara shows them; an environment that matches none is created.

`run.ulid` (`PROBARA_RUN_ULID`) reports into an existing run instead, such as one
`probara run create` made for every shard of a CI job; the reporter never closes a run it did not
create, unless `closeRun` says so. With `--watch`, the reporter creates one run for the whole
session, reports every re-run into it, and never closes it: it logs the `probara run close` command
that closes it. More in [run options](runs.md), [sharding](ci/sharding.md) and
[watch mode](watch.md).

### Several Probara projects

A test whose title names a case of another project (`WEB-7 renders the cart`) goes to that
project when `projects` lists it (`projects: ['WEB']`, `PROBARA_PROJECTS=WEB`): each project gets
its own run, or the one `run.ulids` names (`PROBARA_RUN_ULIDS=WEB=<ulid>`). A test that names only
cases of projects neither `projectId` nor `projects` names is left out, and the `Sending` line
counts it ([Jest and Probara projects](projects.md#several-probara-projects)).

## Status mapping and filter

Each attempt is `passed`, `failed` or `skipped`, from Jest's own verdict: a `test.failing` test
that throws passes, a `test.todo` is skipped with the note `Todo`. `statusMapping` sends a status
as another (`{ failed: 'blocked' }`, `PROBARA_STATUS_MAPPING=failed=blocked`), and `statusFilter`
sends no result with the listed statuses, after the mapping (`['skipped']`,
`PROBARA_STATUS_FILTER=skipped`) ([statuses](statuses.md)).

## Assign failed results

`assignFailedTo` (`PROBARA_ASSIGN_FAILED_TO=ana@example.com,bo@example.com`) assigns each failed
result to one of the listed members, in turn, when its run case has no assignee yet. An email that
matches no member who can work in the project is skipped, and Probara's warning says how many were
([assign failed results](assign-failed.md)).

## Results file

`resultsFile` (`PROBARA_RESULTS_FILE`, relative to the directory `jest` runs in) keeps what could
not be sent, such as when Probara refuses the token, in a JSON file, with the files the results
attach in `<name>-attachments/` next to it; `probara import results` sends it later, into the same
runs. The file is written only when something was not sent, and never over an earlier file: the
reporter then writes to the first free sibling (`probara-results-2.json`).

<!-- project: results-file -->

```js
reporters: ['default', ['@probara/jest-reporter', { resultsFile: 'probara-results.json' }]],
```

<!-- output: results-file, scenario: refused -->

```text
$ npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] 3 results were not sent: Probara answered 403 forbidden: <message from Probara>. No run was created or updated
[probara] Wrote the 3 results that were not sent to /work/shop/probara-results.json: send them with probara import results /work/shop/probara-results.json
```

With reporting off (`enabled: false`, or no token), every result goes to the file, so a job can
run the tests and another job, which holds the token, send them:

```bash
PROBARA_ENABLED=false PROBARA_RESULTS_FILE=probara-results.json npx jest
npx @probara/cli import results 'probara-results*.json'
```

Quote the glob: `probara` expands it, and it matches the file and its siblings
([results file](results-file.md)).

## Debug

`debug: true` (`PROBARA_DEBUG=true`) adds a line for every request (method, path, status, time)
and every retry, and says why reporting is off when it is. Keep it off in normal runs: it is
verbose, though it never logs the token or the bodies ([debugging](debugging.md)).

```bash
PROBARA_DEBUG=true npx jest
```

## What happens with each setup

| Setup                                        | What the reporter does                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| No token and no project, or `enabled: false` | Stays off and quiet: nothing is sent, and nothing is logged (but at debug). |
| Only one of them, or an invalid value        | Reporting is off; each problem is logged, and the tests run as usual.       |
| A token and a project, every value valid     | Reports.                                                                    |

A value of the wrong type (such as `run.tags: 'nightly'` instead of a list) is an invalid value:

<!-- project: invalid, reports: none -->

```js
reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP', run: { tags: 'nightly' } }]],
```

<!-- output: invalid -->

```text
$ npx jest
[probara] Probara reporting is off: run.tags must be a list of strings
```

Problems name the option or the variable at fault, never its value, so a token never shows up.

## Turn reporting off

Set `enabled: false` or `PROBARA_ENABLED=false`, or leave the token out: the reporter sends nothing
and stays quiet. Builds of pull requests from forks get no secrets, so they report nothing on
their own. To keep what a run could not send, even with reporting off, set a
[results file](#results-file).

## Self-hosted Probara

Point the reporter at another Probara with `baseUrl` or `PROBARA_BASE_URL`: the URL of the app,
without a path. Requests go to that host and nowhere else; proxies and private certificate
authorities are in [network](network.md).
