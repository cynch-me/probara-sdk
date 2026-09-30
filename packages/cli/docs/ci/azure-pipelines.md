# Azure Pipelines

Run the import as a step with `condition: always()`, and map the secret into its environment:
Azure Pipelines never exposes secret variables on their own.

> Until `@probara/cli` is published, replace `npx @probara/cli` with a build of this repository
> ([how](../../README.md#use-it-before-it-is-published)).

## 1. Add the secret variable

In the pipeline: **Edit → Variables → New variable**, named `PROBARA_API_TOKEN`, with **Keep this
value secret** checked (or in a variable group). Secret variables are not environment variables:
the step below maps it with `env:`. The token is an app token from the **JUnit XML** card in
**Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. Add the step

A complete `azure-pipelines.yml` for a Playwright project whose config writes
`reports/playwright.xml` ([Playwright](../junit.md#playwright)):

```yaml
trigger:
  - main

pool:
  vmImage: ubuntu-latest

variables:
  PROBARA_PROJECT: SHOP

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
  - script: npm ci
    displayName: Install
  - script: npx playwright install --with-deps
    displayName: Install browsers
  - script: npx playwright test
    displayName: Test
  - script: npx @probara/cli import junit reports/playwright.xml
    displayName: Report to Probara
    # After failed tests too, but not for forks, which get no secrets.
    condition: and(always(), ne(variables['System.PullRequest.IsFork'], 'True'))
    env:
      PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)
```

## Run it even when the tests fail

`always()` runs the step after a failed one. The import exits 0 when tests failed, so the job's
status still comes from the test step ([exit codes](../exit-codes.md)). `continueOnError: true` on
the step keeps a Probara outage from failing the job.

## What CI detection fills in

With `TF_BUILD=True`:

| Field     | From                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Run name  | `BUILD_DEFINITIONNAME #BUILD_BUILDNUMBER`                                                                                     |
| Branch    | `SYSTEM_PULLREQUEST_SOURCEBRANCH` for a pull request, else `BUILD_SOURCEBRANCH`, without `refs/heads/`; none for `refs/tags/` |
| Commit    | `BUILD_SOURCEVERSION`                                                                                                         |
| Build URL | `SYSTEM_COLLECTIONURI` + `SYSTEM_TEAMPROJECT/_build/results?buildId=BUILD_BUILDID`                                            |

`BUILD_BUILDNUMBER` is the build number format of the pipeline (such as `20260929.3`). Set
`PROBARA_RUN_NAME` for another name.

## Fork pull requests

By default, pull request builds from forks do not get secret variables. There, `$(PROBARA_API_TOKEN)`
is not replaced and would reach the CLI as literal text (a 401, exit 1): the condition above skips
the step for forks instead. Do not turn on **Make secrets available to builds of forks**: the fork's
code would get the token.

## See also

- [Sharded runs](sharding.md): parallel jobs into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
