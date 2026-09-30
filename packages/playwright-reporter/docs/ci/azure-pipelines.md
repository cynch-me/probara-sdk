# Azure Pipelines

Map the secret variable into the test step's environment: secret variables never reach scripts on
their own.

## 1. Add the variable

**Pipelines → your pipeline → Edit → Variables → New variable**: name `PROBARA_API_TOKEN`, the
token as the value, **Keep this value secret** on. A variable group of the library works too. The
token is an app token from the **Playwright** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The job

An `azure-pipelines.yml`, sharded with `parallel` into one run created by a first job
([sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it)); without
sharding, keep the test job alone without `strategy` and `PROBARA_RUN_ULID`:

```yaml
jobs:
  - job: create_run
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: '22.x'
      - script: |
          set -e
          ulid=$(npx @probara/cli run create)
          echo "##vso[task.setvariable variable=ulid;isOutput=true]$ulid"
        name: probara
        env:
          PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)
          PROBARA_PROJECT: SHOP

  - job: test
    dependsOn: create_run
    strategy:
      parallel: 4
    variables:
      PROBARA_RUN_ULID: $[ dependencies.create_run.outputs['probara.ulid'] ]
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: '22.x'
      - script: npm ci
      - script: npx playwright install --with-deps
      - script: npx playwright test --shard=$(System.JobPositionInPhase)/$(System.TotalJobsInPhase)
        env:
          PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)
          PROBARA_PROJECT: SHOP
          PROBARA_RUN_ULID: $(PROBARA_RUN_ULID)

  - job: close_run
    dependsOn: [create_run, test]
    condition: always()
    variables:
      PROBARA_RUN_ULID: $[ dependencies.create_run.outputs['probara.ulid'] ]
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: '22.x'
      - script: npx @probara/cli run close
        env:
          PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)
          PROBARA_PROJECT: SHOP
          PROBARA_RUN_ULID: $(PROBARA_RUN_ULID)
```

`set -e` makes a failed `run create` fail the first job: Azure checks only the last command of a
script, and the shards would each create a run of their own.

Builds of pull requests from forks get no secret variables unless **Make secrets available to
builds of forks** is on (leave it off): the reporter stays quiet there.

With `TF_BUILD=True`, the run is named `BUILD_DEFINITIONNAME #BUILD_BUILDNUMBER`, and its branch,
commit and build URL come from the pipeline's variables
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
