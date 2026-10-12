# Configuration

Every setting is an option of the reporter in the Vitest config, and most have a `PROBARA_*`
variable too. Keep the token in the environment, the project in the config (or the environment),
and set the rest where it fits your pipeline.

## Quick path

1. Create an app token from the **Vitest** card in **Integrations** ([get a token](#get-a-token))
   and store it as a CI secret named `PROBARA_API_TOKEN`.
2. Set the project code: `projectId` in the reporter options, or `PROBARA_PROJECT`. A project code
   is a capital letter, then capital letters or digits (`SHOP`, `E2E`): any other value turns
   reporting off with an error.
3. Everything else has a default. The run is named after the CI build, and its branch, commit and
   build URL come from the CI on their own.

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]],
  },
});
```

Keep `'default'` in the list: a `reporters` list replaces Vitest's own, and `default` is the one you
read in the terminal. The reporter entry is the same in any file Vitest reads its config from
(`vitest.config.ts`, the `test` section of `vite.config.ts`...). The reporter adds its own setup
file and runner to every Vitest project of the config, so there is nothing to add to `setupFiles`
or `runner`.

## Get a token

Report with an app token. It belongs to your organization, not to a person:

1. As an admin or owner, open **Workspace › Integrations** in Probara and select the **Vitest**
   card.
2. Open the **Access tokens** tab, select **Create an app token**, enter a **Token name** after what
   uses it (the repository or the pipeline) and select **Create token**.
3. Select **Copy token**. It is shown once: store it as the CI secret `PROBARA_API_TOKEN` right
   away.

What an app token is:

- It uses no seat, and it keeps working when the person who created it leaves the organization.
- Its runs and results show the app and the token's name (such as **Vitest · unit-ci**), not a
  person.
- It can only report: create automated runs, send reports (which can create cases and suites),
  upload result attachments, close runs, and read the case keys of a run (for `runCasesOnly`). It
  cannot read anything else. The
  [`probara` CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md) takes the
  same token for `run create` and `run close`.
- Revoke it from the same card when it may have leaked, then create a new one.

Reporting from CI needs a paid plan: on the Free plan, Probara refuses the token (`403 forbidden`).
The [Vitest integration guide](https://docs.probara.net/en/guides/integrations/vitest/) covers the
card in detail.

Do not put the token in the Vitest config: the config is committed. `apiToken` exists for code that
reads the token from its own secret store.

## Sources and precedence

The first source that sets a value wins:

| Order | Source                                         | Example                                   |
| ----- | ---------------------------------------------- | ----------------------------------------- |
| 1     | An option of the reporter in the Vitest config | `{ run: { name: 'Release 2.4' } }`        |
| 2     | A `PROBARA_*` variable                         | `PROBARA_RUN_NAME=Nightly`                |
| 3     | CI detection                                   | `CI #42` from the workflow and run number |
| 4     | The default                                    | `Automated run 2026-09-29 14:05 UTC`      |

- An option set to `undefined` never hides its variable, and a blank variable counts as unset. To
  let a variable override an option, leave the option out (or pass `process.env.X ?? default`).
- Booleans accept `true`, `1`, `yes`, `on` and `false`, `0`, `no`, `off`. Lists are
  comma-separated in variables (`PROBARA_RUN_TAGS=nightly,smoke`).
- CI detection only fills the run's name and its source (branch, commit, build URL):
  [what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection).

Options and variables can be mixed. This config sets the project and tags:

```ts
reporters: [
  'default',
  ['@probara/vitest-reporter', { projectId: 'SHOP', run: { tags: ['unit', 'nightly'] } }],
],
```

and the pipeline adds the run's environment and name:

```bash
PROBARA_ENVIRONMENT=staging PROBARA_RUN_NAME=Nightly npx vitest run
```

## Options

Each option, its variable, its type and its default. The pages linked from a row explain it in full.

<!-- options-table -->

| Option                   | Variable                       | Type                                    | Default                                        | What it does                                                                                                      |
| ------------------------ | ------------------------------ | --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`                | `PROBARA_ENABLED`              | `boolean`                               | on                                             | `false` turns reporting off: nothing is sent, and nothing is logged                                               |
| `apiToken`               | `PROBARA_API_TOKEN`            | `string`                                | none (required)                                | The app token. Keep it in the environment                                                                         |
| `projectId`              | `PROBARA_PROJECT`              | `string`                                | none (required)                                | The project code (capital letters and digits), such as `SHOP`                                                     |
| `baseUrl`                | `PROBARA_BASE_URL`             | `string`                                | `https://app.probara.net`                      | The Probara to report to ([self-hosted](#self-hosted-probara))                                                    |
| `run.ulid`               | `PROBARA_RUN_ULID`             | `string`                                | none: a new run                                | Report into an existing run ([an existing run](runs.md#an-existing-run))                                          |
| `run.name`               | `PROBARA_RUN_NAME`             | `string`                                | the CI build name, else `Automated run <date>` | Name of a new run ([run options](runs.md))                                                                        |
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
| `source`                 | —                              | `false \| { branch, commit, buildUrl }` | detected from the CI                           | `false` sends no source; an object overrides the detected fields one by one ([run source](runs.md#run-source))    |
| `source.branch`          | `PROBARA_BRANCH`               | `string`                                | detected from the CI                           | Branch of the run source                                                                                          |
| `source.commit`          | `PROBARA_COMMIT`               | `string`                                | detected from the CI                           | Commit of the run source                                                                                          |
| `source.buildUrl`        | `PROBARA_BUILD_URL`            | `string`                                | detected from the CI                           | CI build URL of the run source                                                                                    |
| `createMissingCases`     | `PROBARA_CREATE_MISSING_CASES` | `boolean`                               | `true`                                         | Create a case for a test that matches none                                                                        |
| `suiteUlid`              | `PROBARA_SUITE_ULID`           | `string`                                | the project root                               | Suite that created cases go under                                                                                 |
| `closeRun`               | `PROBARA_CLOSE_RUN`            | `boolean`                               | `true` for a new run, `false` for a reused one | Close the run at the end (never in watch mode) ([closing](runs.md#closing))                                       |
| `closeRuns`              | —                              | `Record<string, boolean>`               | none                                           | Close the run of each project (`{ SHOP: true, WEB: false }`) when `closeRun` is not set                           |
| `uploadAttachments`      | `PROBARA_UPLOAD_ATTACHMENTS`   | `boolean`                               | `true`                                         | `false` uploads no file                                                                                           |
| `keyIncludesFile`        | `PROBARA_KEY_INCLUDES_FILE`    | `boolean`                               | `true`                                         | Start each automation key with the test file                                                                      |
| `captureOutput`          | `PROBARA_CAPTURE_OUTPUT`       | `boolean`                               | `false`                                        | Attach each attempt's console output as `stdout.log` and `stderr.log`                                             |
| `attachScreenshots`      | `PROBARA_ATTACH_SCREENSHOTS`   | `boolean`                               | `true`                                         | Attach a browser test's failure screenshots to its attempt; `false` turns them off                                |
| `issueUrlTemplate`       | `PROBARA_ISSUE_URL_TEMPLATE`   | `string`                                | none                                           | The URL each `probara.issue(id)` becomes, with `%s` for the id                                                    |
| `runCasesOnly`           | `PROBARA_RUN_CASES_ONLY`       | `boolean`                               | `false`                                        | Run only the tests of the cases of `run.ulid`                                                                     |
| `statusMapping`          | `PROBARA_STATUS_MAPPING`       | `{ passed, failed, skipped, blocked }`  | none                                           | Send a status as another (`failed=blocked`) ([statuses](statuses.md#status-mapping-and-filter))                   |
| `statusFilter`           | `PROBARA_STATUS_FILTER`        | `string[]`                              | none                                           | Send no result with these statuses, after the mapping (`skipped`)                                                 |
| `resultsFile`            | `PROBARA_RESULTS_FILE`         | `string`                                | none                                           | JSON file for what could not be sent                                                                              |
| `assignFailedTo`         | `PROBARA_ASSIGN_FAILED_TO`     | `string[]`                              | none                                           | Assign each failed result without an assignee to one of these members, in turn (`ana@example.com,bo@example.com`) |
| `debug`                  | `PROBARA_DEBUG`                | `boolean`                               | `false`                                        | Log every request                                                                                                 |
| `rootDir`                | —                              | `string`                                | the Vitest root                                | Directory the file paths of automation keys are relative to                                                       |
| `chunkSize`              | —                              | `number`                                | `500`                                          | Results per report request, 1 to 500                                                                              |
| `timeoutMs`              | —                              | `number`                                | `30000`                                        | Timeout of one HTTP attempt, in milliseconds, 1 to 600000                                                         |
| `maxRetries`             | —                              | `number`                                | `4`                                            | Retries of a failed request, 0 to 10                                                                              |
| `attachmentConcurrency`  | —                              | `number`                                | `2`                                            | Results whose attachments upload at the same time, 1 to 8                                                         |

`rootDir` defaults to Vitest's `root`, which is the directory `vitest` runs in unless the config or
`--root` sets another. An option the reporter does not know is left out with a warning, and the run
still reports:

<!-- project: misspelled -->

```ts
reporters: ['default', ['@probara/vitest-reporter', { captureOutputs: true }]],
```

<!-- output: misspelled -->

```text
$ npx vitest run
[probara] Ignored the unknown option "captureOutputs" of @probara/vitest-reporter
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

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

The default logger writes through Vitest's own logger, on stderr: stdout stays Vitest's, so a
reporter that prints JSON there never gets a line of the reporter's.

## What happens with each setup

| Setup                                        | What the reporter does                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| No token and no project, or `enabled: false` | Stays off and quiet: nothing is sent, and nothing is logged (but at debug). |
| Only one of them, or an invalid value        | Reporting is off; each problem is logged, and the tests run as usual.       |
| A token and a project, every value valid     | Reports.                                                                    |

A value of the wrong type (such as `run.tags: 'nightly'` instead of a list) is an invalid value:

<!-- project: invalid, reports: none -->

```ts
reporters: ['default', ['@probara/vitest-reporter', { run: { tags: 'nightly' } }]],
```

<!-- output: invalid -->

```text
$ npx vitest run
[probara] Probara reporting is off: run.tags must be a list of strings
```

Problems name the option or the variable at fault, never its value, so a token never shows up. The
reporter never fails the run: whatever goes wrong while reporting is a `[probara]` line on stderr,
and the exit code of `vitest` stays the one the tests give.

## Turn reporting off

Set `enabled: false` or `PROBARA_ENABLED=false`, or leave the token out: the reporter sends nothing
and stays quiet. Builds of pull requests from forks get no secrets, so they report nothing on their
own. The reporter still adds its setup file, so the `probara.*` helpers keep recording, and nothing
is sent ([metadata](metadata.md#how-metadata-travels)). To keep what a run could not send, even
with reporting off, set a `resultsFile`.

## Self-hosted Probara

Point the reporter at another Probara with `baseUrl` or `PROBARA_BASE_URL`: the URL of the app,
without a path. Requests go to that host and nowhere else.

## See also

- [Run options](runs.md): name, environment, milestone and closing of the run.
- [Statuses](statuses.md) and [retries](retries.md): what each attempt sends.
- [Metadata](metadata.md) and [steps](steps.md): the `probara.*` helpers.
