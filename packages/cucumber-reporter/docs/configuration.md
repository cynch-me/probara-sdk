# Configuration

Every setting is an option of the formatter under the `probara` key of the Cucumber
`formatOptions`, and most have a `PROBARA_*` variable too. Keep the token in the environment, the
project in the configuration (or the environment), and set the rest where it fits your pipeline.

## Quick path

1. Create an app token from the **Cucumber** card in **Integrations** ([get a token](#get-a-token))
   and store it as a CI secret named `PROBARA_API_TOKEN`.
2. Set the project code: `projectId` in the formatter options, or `PROBARA_PROJECT`. A project code
   is a capital letter, then capital letters or digits (`SHOP`, `E2E`): any other value turns
   reporting off with an error.
3. Everything else has a default. The run is named after the CI build, and its branch, commit and
   build URL come from the CI on their own.

```js
// cucumber.js
module.exports = {
  default: {
    format: ['@probara/cucumber-reporter'],
    formatOptions: { probara: { projectId: 'SHOP' } },
  },
};
```

The same options work on the command line: `--format-options '{"probara":{"projectId":"SHOP"}}'`.
An option given in `formatOptions` wins over its `PROBARA_*` variable, which wins over the default.

## Where the output goes

cucumber-js gives stdout to one formatter: the last `--format` without a path. With no `--format` at
all, that is its own `progress` formatter. So `--format @probara/cucumber-reporter` on its own
prints nothing on stdout, and the `[probara]` lines go to stderr.

To keep the progress output, give the formatter a path: `--format progress --format
@probara/cucumber-reporter:reports/probara.txt`. The formatter writes nothing to that file (its
logs go to stderr), so it stays empty. Two formatters without a path do not both print: cucumber-js
keeps the last one and drops the other, silently.

A `formatOptions` key that is not `probara` is not read by this formatter. An option under `probara`
that the formatter does not know is left out, with a warning on stderr that names it; the other
options still apply.

## Get a token

Report with an app token. It belongs to your organization, not to a person:

1. As an admin or owner, open **Workspace › Integrations** in Probara and pick the **Cucumber**
   card.
2. Enter a **Token name** after what uses it (the repository or the pipeline) and select
   **Create token**.
3. Select **Copy token**. It is shown once: store it as the CI secret `PROBARA_API_TOKEN` right away.

An app token uses no seat, keeps working when the person who created it leaves, and shows the app and
its name (such as **Cucumber · e2e-ci**) on its runs and results. It can only report: create
automated runs, send reports (which can create cases and suites), upload result attachments and close
runs. Revoke it from the same card when it may have leaked.

## Options

<!-- options-table -->

| Option                   | Variable                       | Type                                    | Default                                        | What it does                                                                                                      |
| ------------------------ | ------------------------------ | --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`                | `PROBARA_ENABLED`              | `boolean`                               | on                                             | `false` turns reporting off: nothing is sent, and nothing is logged                                               |
| `apiToken`               | `PROBARA_API_TOKEN`            | `string`                                | none (required)                                | The app token. Keep it in the environment                                                                         |
| `projectId`              | `PROBARA_PROJECT`              | `string`                                | none (required)                                | The project code (capital letters and digits), such as `SHOP`                                                     |
| `baseUrl`                | `PROBARA_BASE_URL`             | `string`                                | `https://app.probara.net`                      | The Probara to report to ([network](network.md))                                                                  |
| `run.ulid`               | `PROBARA_RUN_ULID`             | `string`                                | none: a new run                                | Report into an existing run ([runs](runs.md))                                                                     |
| `run.name`               | `PROBARA_RUN_NAME`             | `string`                                | the CI build name, else `Automated run <date>` | Name of a new run                                                                                                 |
| `run.description`        | `PROBARA_RUN_DESCRIPTION`      | `string`                                | none                                           | Description of a new run                                                                                          |
| `run.environment`        | `PROBARA_ENVIRONMENT`          | `string`                                | none                                           | Environment of a new run by name, created when none matches ([runs](runs.md))                                     |
| `run.environmentId`      | `PROBARA_ENVIRONMENT_ID`       | `string`                                | none                                           | Environment of a new run by ULID                                                                                  |
| `run.milestone`          | `PROBARA_MILESTONE`            | `string`                                | none                                           | Milestone of a new run by display id (`M-3`) or name                                                              |
| `run.milestoneId`        | `PROBARA_MILESTONE_ID`         | `string`                                | none                                           | Milestone of a new run by ULID                                                                                    |
| `run.plan`               | `PROBARA_PLAN`                 | `string`                                | none                                           | Test plan of a new run by display id (`PLAN-2`) or name: the run starts with its cases                            |
| `run.configurations`     | `PROBARA_CONFIGURATIONS`       | `{ group, name }[]`                     | none                                           | Configurations of a new run by name (`Browser=Chrome,OS=Linux`), each group once                                  |
| `run.configurationUlids` | `PROBARA_CONFIGURATION_ULIDS`  | `string[]`                              | none                                           | Configurations of a new run by ULID                                                                               |
| `run.tags`               | `PROBARA_RUN_TAGS`             | `string[]`                              | none                                           | Tags of a new run                                                                                                 |
| `run.ulids`              | `PROBARA_RUN_ULIDS`            | `Record<string, string>`                | none                                           | The run to reuse in each project (`WEB=<ulid>,API=<ulid>`) ([runs](runs.md))                                      |
| `projects`               | `PROBARA_PROJECTS`             | `string[]`                              | none                                           | Other projects results may go to (`WEB,API`), by the case of each result ([linking](linking.md))                  |
| `source`                 | —                              | `false \| { branch, commit, buildUrl }` | detected from the CI                           | `false` sends no source; an object overrides the detected fields one by one                                       |
| `source.branch`          | `PROBARA_BRANCH`               | `string`                                | detected from the CI                           | Branch of the run source                                                                                          |
| `source.commit`          | `PROBARA_COMMIT`               | `string`                                | detected from the CI                           | Commit of the run source                                                                                          |
| `source.buildUrl`        | `PROBARA_BUILD_URL`            | `string`                                | detected from the CI                           | CI build URL of the run source                                                                                    |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES` | `boolean`                               | `true`                                         | Create a case for a scenario that matches none ([linking](linking.md#scenarios-without-a-synced-case))            |
| `suiteUlid`              | `PROBARA_SUITE_ULID`           | `string`                                | the project root                               | Suite that created cases go under                                                                                 |
| `closeRun`               | `PROBARA_CLOSE_RUN`            | `boolean`                               | `true` for a new run, `false` for a reused one | Close the run at the end                                                                                          |
| `closeRuns`              | —                              | `Record<string, boolean>`               | none                                           | Close the run of each project (`{ SHOP: true, WEB: false }`) when `closeRun` is not set                           |
| `uploadAttachments`      | `PROBARA_UPLOAD_ATTACHMENTS`   | `boolean`                               | `true`                                         | `false` uploads no file ([attachments](attachments.md))                                                           |
| `statusMapping`          | `PROBARA_STATUS_MAPPING`       | `{ passed, failed, skipped, blocked }`  | none                                           | Send a status as another (`failed=blocked`) ([statuses](statuses.md#status-mapping-and-filter))                   |
| `statusFilter`           | `PROBARA_STATUS_FILTER`        | `string[]`                              | none                                           | Send no result with these statuses, after the mapping (`skipped`)                                                 |
| `resultsFile`            | `PROBARA_RESULTS_FILE`         | `string`                                | none                                           | JSON file for what could not be sent ([results file](results-file.md))                                            |
| `assignFailedTo`         | `PROBARA_ASSIGN_FAILED_TO`     | `string[]`                              | none                                           | Assign each failed result without an assignee to one of these members, in turn (`ana@example.com,bo@example.com`) |
| `debug`                  | `PROBARA_DEBUG`                | `boolean`                               | `false`                                        | Log every request ([troubleshooting](troubleshooting.md))                                                         |
| `rootDir`                | —                              | `string`                                | the directory Cucumber runs in                 | Directory the feature paths of automation keys are relative to ([linking](linking.md#the-key))                    |
| `chunkSize`              | —                              | `number`                                | `500`                                          | Results per report request, 1 to 500                                                                              |
| `timeoutMs`              | —                              | `number`                                | `30000`                                        | Timeout of one HTTP attempt, in milliseconds, 1 to 600000 ([network](network.md))                                 |
| `maxRetries`             | —                              | `number`                                | `4`                                            | Retries of a failed request, 0 to 10                                                                              |
| `attachmentConcurrency`  | —                              | `number`                                | `2`                                            | Results whose attachments upload at the same time, 1 to 8                                                         |

The formatter sends its own name and version in the `User-Agent` (such as
`probara-cucumber-reporter/0.1.0 probara-core/0.5.0 node/22.12.0`); there is no option for it.

For code and tests, the formatter also takes the seams of `@probara/core`. They have no variable, and
a `cucumber.js` rarely needs them:

<!-- runtime-options-table -->

| Option   | Variable | Type                           | Default                     | What it does                                             |
| -------- | -------- | ------------------------------ | --------------------------- | -------------------------------------------------------- |
| `logger` | —        | `{ debug, info, warn, error }` | `[probara]` lines on stderr | Where the formatter logs                                 |
| `env`    | —        | `Record<string, string>`       | `process.env`               | Where `PROBARA_*` and CI variables are read from         |
| `fetch`  | —        | `function`                     | the global `fetch`          | The HTTP client                                          |
| `sleep`  | —        | `function`                     | `setTimeout`                | Waits between retries                                    |
| `random` | —        | `function`                     | `Math.random`               | Jitter of the retry backoff                              |
| `now`    | —        | `function`                     | the current time            | Clock of the default run name and of `Retry-After` dates |
