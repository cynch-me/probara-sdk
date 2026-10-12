# Azure Pipelines

Map the secret variable into the test step's environment: secret variables never reach scripts on
their own. The reporter runs inside `npx vitest run`, reports the run when Vitest ends, and never
prints the token.

## 1. Add the variable

**Pipelines → your pipeline → Edit → Variables → New variable**: name `PROBARA_API_TOKEN`, the
token as the value, **Keep this value secret** on. A variable group of the library works too. The
token is an app token from the **Vitest** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The job

An `azure-pipelines.yml` with the reporter registered in `vitest.config.mts` as in the
[quick start](../../README.md#quick-start):

```yaml
pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
  - script: npm ci
  - script: npx vitest run
    env:
      PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)
      PROBARA_PROJECT: SHOP
```

Failed tests fail the step, reporting problems do not
([what the reporter never does](../debugging.md#what-the-reporter-never-does-to-the-run)).
Every other setting is an option or a `PROBARA_*` variable of the step
([configuration](../configuration.md#options)).

## Sharded jobs: one run

Sharded with `parallel` into one run created by a first job, and closed by a last one that runs
even after failed shards ([sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it)):

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
      - script: npx vitest run --shard=$(System.JobPositionInPhase)/$(System.TotalJobsInPhase)
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

`System.JobPositionInPhase` counts from 1, like Vitest's shards. Each shard sends its results when
it ends, into the run of `create_run`.

## Forks and CI detection

Builds of pull requests from forks get no secret variables unless **Make secrets available to
builds of forks** is on (leave it off). There `$(PROBARA_API_TOKEN)` is not replaced and reaches
the reporter as text: Probara refuses it (401), the reporter logs that the results were not sent,
and the tests run as usual. In the sharded pipeline, a fork's `run create` exits 1 the same way, and
its shards never start. To report nothing in fork builds, start each script that runs `vitest` or
`probara` with `if [ "$SYSTEM_PULLREQUEST_ISFORK" = True ]; then export PROBARA_ENABLED=false; fi`:
`run create` then prints no ULID and exits 0, the shards report nothing, and `run close` exits 0.

With `TF_BUILD=True`, the run is named `BUILD_DEFINITIONNAME #BUILD_BUILDNUMBER`, and its branch,
commit and build URL come from the pipeline's variables
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md): the blob reports, merged into one run, are the other way.
- [Troubleshooting](../troubleshooting.md).
