# Azure Pipelines

Map the secret variable into the test step's environment: secret variables never reach scripts on
their own.

## 1. Add the variable

**Pipelines → your pipeline → Edit → Variables → New variable**: name `PROBARA_API_TOKEN`, the
token as the value, **Keep this value secret** on. A variable group of the library works too. The
token is an app token from the **Cypress** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The job

An `azure-pipelines.yml` with the reporter registered in `cypress.config.js` as in the
[quick start](../../README.md#quick-start):

```yaml
pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
  - script: npm ci
  - script: npx cypress run
    env:
      PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)
      PROBARA_PROJECT: SHOP
```

## Parallel jobs: one run

A `matrix` of jobs that each run part of the specs, into one run created by a first job, and closed
by a last one that runs even after failed tests ([sharding](sharding.md#create-the-run-report-from-each-machine-close-it)):

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
      matrix:
        cart:
          SPEC: 'cypress/e2e/cart/**'
        login:
          SPEC: 'cypress/e2e/login/**'
    variables:
      PROBARA_RUN_ULID: $[ dependencies.create_run.outputs['probara.ulid'] ]
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: NodeTool@0
        inputs:
          versionSpec: '22.x'
      - script: npm ci
      - script: npx cypress run --spec '$(SPEC)'
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

Each matrix entry is a job of its own with its `SPEC`; `ubuntu-latest` has the browsers and the
system libraries Cypress needs.

## Forks and CI detection

Builds of pull requests from forks get no secret variables unless **Make secrets available to
builds of forks** is on (leave it off): the reporter stays quiet there.

With `TF_BUILD=True`, the run is named `BUILD_DEFINITIONNAME #BUILD_BUILDNUMBER`, and its branch,
commit and build URL come from the pipeline's variables
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
