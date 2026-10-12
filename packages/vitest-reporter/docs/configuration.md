# Configuration

The reporter takes its options from the `reporters` entry of the Vitest configuration, from the environment, or from
both: an option set in the configuration wins over its variable, and a variable is what a CI job sets.

## Options

<!-- options-table -->

| Option                   | Variable                       | Type                                    | Default                                        | What it does                                                                                                      |
| ------------------------ | ------------------------------ | --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`                | `PROBARA_ENABLED`              | `boolean`                               | on                                             | `false` turns reporting off: nothing is sent, and nothing is logged                                               |
| `apiToken`               | `PROBARA_API_TOKEN`            | `string`                                | none (required)                                | The app token. Keep it in the environment                                                                         |
| `projectId`              | `PROBARA_PROJECT`              | `string`                                | none (required)                                | The project code (capital letters and digits), such as `SHOP`                                                     |
| `baseUrl`                | `PROBARA_BASE_URL`             | `string`                                | `https://app.probara.net`                      | The Probara to report to                                                                                          |
| `run.ulid`               | `PROBARA_RUN_ULID`             | `string`                                | none: a new run                                | Report into an existing run                                                                                       |
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
| `run.ulids`              | `PROBARA_RUN_ULIDS`            | `Record<string, string>`                | none                                           | The run to reuse in each project (`WEB=<ulid>,API=<ulid>`)                                                        |
| `projects`               | `PROBARA_PROJECTS`             | `string[]`                              | none                                           | Other projects results may go to (`WEB,API`)                                                                      |
| `source`                 | —                              | `false \| { branch, commit, buildUrl }` | detected from the CI                           | `false` sends no source; an object overrides the detected fields one by one                                       |
| `source.branch`          | `PROBARA_BRANCH`               | `string`                                | detected from the CI                           | Branch of the run source                                                                                          |
| `source.commit`          | `PROBARA_COMMIT`               | `string`                                | detected from the CI                           | Commit of the run source                                                                                          |
| `source.buildUrl`        | `PROBARA_BUILD_URL`            | `string`                                | detected from the CI                           | CI build URL of the run source                                                                                    |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES` | `boolean`                               | `true`                                         | Create a case for a test that matches none                                                                        |
| `suiteUlid`              | `PROBARA_SUITE_ULID`           | `string`                                | the project root                               | Suite that created cases go under                                                                                 |
| `closeRun`               | `PROBARA_CLOSE_RUN`            | `boolean`                               | `true` for a new run, `false` for a reused one | Close the run at the end (never in watch mode)                                                                    |
| `closeRuns`              | —                              | `Record<string, boolean>`               | none                                           | Close the run of each project (`{ SHOP: true, WEB: false }`) when `closeRun` is not set                           |
| `uploadAttachments`      | `PROBARA_UPLOAD_ATTACHMENTS`   | `boolean`                               | `true`                                         | `false` uploads no file                                                                                           |
| `keyIncludesFile`        | `PROBARA_KEY_INCLUDES_FILE`    | `boolean`                               | `true`                                         | Start each automation key with the test file                                                                      |
| `captureOutput`          | `PROBARA_CAPTURE_OUTPUT`       | `boolean`                               | `false`                                        | Attach each attempt's console output as `stdout.log` and `stderr.log`                                             |
| `attachScreenshots`      | `PROBARA_ATTACH_SCREENSHOTS`   | `boolean`                               | `true`                                         | Attach a browser test's failure screenshots to its attempt; `false` turns them off                                |
| `issueUrlTemplate`       | `PROBARA_ISSUE_URL_TEMPLATE`   | `string`                                | none                                           | The URL each `probara.issue(id)` becomes, with `%s` for the id                                                    |
| `runCasesOnly`           | `PROBARA_RUN_CASES_ONLY`       | `boolean`                               | `false`                                        | Run only the tests of the cases of `run.ulid`                                                                     |
| `statusMapping`          | `PROBARA_STATUS_MAPPING`       | `{ passed, failed, skipped, blocked }`  | none                                           | Send a status as another (`failed=blocked`)                                                                       |
| `statusFilter`           | `PROBARA_STATUS_FILTER`        | `string[]`                              | none                                           | Send no result with these statuses, after the mapping (`skipped`)                                                 |
| `resultsFile`            | `PROBARA_RESULTS_FILE`         | `string`                                | none                                           | JSON file for what could not be sent                                                                              |
| `assignFailedTo`         | `PROBARA_ASSIGN_FAILED_TO`     | `string[]`                              | none                                           | Assign each failed result without an assignee to one of these members, in turn (`ana@example.com,bo@example.com`) |
| `debug`                  | `PROBARA_DEBUG`                | `boolean`                               | `false`                                        | Log every request                                                                                                 |
| `rootDir`                | —                              | `string`                                | the working directory                          | Directory the file paths of automation keys are relative to                                                       |
| `chunkSize`              | —                              | `number`                                | `500`                                          | Results per report request, 1 to 500                                                                              |
| `timeoutMs`              | —                              | `number`                                | `30000`                                        | Timeout of one HTTP attempt, in milliseconds, 1 to 600000                                                         |
| `maxRetries`             | —                              | `number`                                | `4`                                            | Retries of a failed request, 0 to 10                                                                              |
| `attachmentConcurrency`  | —                              | `number`                                | `2`                                            | Results whose attachments upload at the same time, 1 to 8                                                         |

## Runtime options

These are seams for code (a test of the reporter, a custom logger), not settings of a job.

<!-- runtime-options-table -->

| Option   | Variable | Type                           | Default                     | What it does                                             |
| -------- | -------- | ------------------------------ | --------------------------- | -------------------------------------------------------- |
| `logger` | —        | `{ debug, info, warn, error }` | `[probara]` lines on stderr | Where the reporter logs                                  |
| `env`    | —        | `Record<string, string>`       | `process.env`               | Where `PROBARA_*` and CI variables are read from         |
| `fetch`  | —        | `function`                     | the global `fetch`          | The HTTP client                                          |
| `sleep`  | —        | `function`                     | `setTimeout`                | Waits between retries                                    |
| `random` | —        | `function`                     | `Math.random`               | Jitter of the retry backoff                              |
| `now`    | —        | `function`                     | the current time            | Clock of the default run name and of `Retry-After` dates |
