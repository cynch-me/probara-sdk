# @probara/playwright-reporter

A [Playwright](https://playwright.dev) reporter that sends every test result of a run to
[Probara](https://probara.net): each attempt with its status, steps, errors and attachments, linked
to its Probara test case. Cases that are missing get created, and the run is closed once everything
is in. Built on [`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md).

## Features

- **One result per attempt**, retries included, with Playwright's own verdict: `test.fail()`,
  skips with their reasons, timeouts ([statuses](docs/statuses.md), [retries](docs/retries.md)).
- **Linking** by a `probara_case` annotation, a case id in the title (`SHOP-12 logs in`) or
  `probara.id()`, with the same automation keys as `probara import junit`
  ([linking](docs/linking.md)).
- **Steps** from `test.step` and hooks, nested, with the files attached inside them; declared case
  steps with `probara.step(action, expected, data)` ([steps](docs/steps.md)).
- **Attachments**: screenshots, videos, traces, error context, `testInfo.attach()` and
  `probara.attach()` ([attachments](docs/attachments.md)).
- **Metadata** for the cases a report creates: title, suite, tags, system and custom fields,
  parameters, comments ([metadata](docs/metadata.md)).
- **Runs** by name: environment, milestone, test plan, configurations, tags and the CI source
  ([run options](docs/runs.md)); sharded CI and `merge-reports` into one run
  ([sharding](docs/ci/sharding.md)); several Probara projects ([multi-project](docs/multi-project.md)).
- **Never breaks your test run**: a reporting problem is logged, never thrown, and Playwright's
  exit code stays the tests' own. What could not be sent can be kept in a file and sent later with
  `probara import results 'probara-results*.json'`, never overwriting an earlier file
  ([results file](docs/results-file.md)).

## Requirements

- Node.js 22.12 or later.
- `@playwright/test` 1.42 or later.
- A Probara app token, created from the **Playwright** card in **Integrations**
  ([get a token](docs/configuration.md#get-a-token)), and the code of the project to report into
  (such as `SHOP`). Reporting from CI needs a paid plan.

## Install

```bash
npm i -D @probara/playwright-reporter
```

## Quick start

1. In Probara, open **Workspace › Integrations**, pick the **Playwright** card and create a token
   ([get a token](docs/configuration.md#get-a-token)). Store it as a CI secret named
   `PROBARA_API_TOKEN`: the reporter reads it from the environment, never from the config.
2. Add the reporter next to the one you read in the terminal, with your project code (or set
   `PROBARA_PROJECT` instead):

   ```ts
   // playwright.config.ts
   import { defineConfig } from '@playwright/test';

   export default defineConfig({
     reporter: [['list'], ['@probara/playwright-reporter', { projectId: 'SHOP' }]],
   });
   ```

3. Run your tests with the token in the environment. In GitHub Actions:

   ```yaml
   - name: Run Playwright tests
     run: npx playwright test
     env:
       PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
   ```

Without a token and a project the reporter stays off and quiet, so local runs send nothing. In CI
it logs on stderr, in `[probara]` lines, and ends with the link to the run:

<!-- output: default -->

```text
$ npx playwright test
[probara] Sending 2 results of 2 tests (2 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

Pick your CI in [the CI guides](#documentation) for a complete workflow.

## What gets reported

| Playwright                               | In Probara                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| A test (per Playwright project)          | A test case, matched by its automation key or linked by a case id         |
| Each attempt (retries included)          | A result in the run, with its status, duration, start time and errors     |
| `test.step` and the hooks that run steps | The steps of the result, nested, with their status, duration and error    |
| Screenshots, videos, traces, attachments | Files of the result, or of the step they were attached in                 |
| `probara.*` calls in the test            | The title, suite, tags, fields and steps of a new case; result parameters |
| The `playwright test` command            | One automated run, named after the CI build, closed at the end            |

## Documentation

| Page                                               | What it covers                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Configuration](docs/configuration.md)             | Every option, its variable, type and default; precedence; getting a token     |
| [Linking tests to cases](docs/linking.md)          | Annotations, case ids in titles, `probara.id()`, automation keys              |
| [Metadata](docs/metadata.md)                       | Title, suite, comment, tags, fields, parameters, ignoring an attempt          |
| [Steps](docs/steps.md)                             | `test.step`, hooks, nesting, `probara.step()` and the steps of a new case     |
| [Attachments](docs/attachments.md)                 | Screenshots, videos, traces, `probara.attach()`, test output, limits          |
| [Statuses](docs/statuses.md)                       | How attempts become statuses; `test.fail()`, skips; status mapping and filter |
| [Retries and flaky tests](docs/retries.md)         | Every attempt is a result                                                     |
| [Run options](docs/runs.md)                        | Name, description, environment, milestone, plan, configurations, tags, source |
| [Sharding and CI](docs/ci/sharding.md)             | One run for every shard; `merge-reports`                                      |
| [Several projects](docs/multi-project.md)          | Results that go to other Probara projects, each into its own run              |
| [Results file](docs/results-file.md)               | Keep what could not be sent, send it later                                    |
| [Migrating from Qase](docs/migrating-from-qase.md) | Option by option and API by API, and what is different                        |
| [Troubleshooting](docs/troubleshooting.md)         | Problems and their solutions                                                  |
| [Debugging](docs/debugging.md)                     | `PROBARA_DEBUG`, the logs, checking what would be sent                        |
| [Network](docs/network.md)                         | Timeouts, retries, rate limits, proxies and certificates                      |
| [Upgrading](docs/upgrade.md)                       | Versioning policy and the automation key contract                             |
| [Changelog](CHANGELOG.md)                          | What changed in each version                                                  |

CI guides: [GitHub Actions](docs/ci/github-actions.md), [GitLab CI](docs/ci/gitlab.md),
[CircleCI](docs/ci/circleci.md), [Azure Pipelines](docs/ci/azure-pipelines.md),
[Jenkins](docs/ci/jenkins.md), [Bitbucket Pipelines](docs/ci/bitbucket.md) and
[Buildkite](docs/ci/buildkite.md).

On the Probara side, the [Playwright integration guide](https://docs.probara.net/en/guides/integrations/playwright/)
covers the card, its app tokens and what Probara shows.

## Reporting never breaks your test run

The reporter never throws into Playwright and never changes its exit code: a failed test fails the
command, a reporting problem does not. Every problem (a wrong setting, Probara unreachable, a
refused token) is logged on stderr, and the tests keep their outcome. There is no option to fail
the command on a reporting error; to keep what could not be sent, set a
[results file](docs/results-file.md).

## License

[Apache License 2.0](./LICENSE).
