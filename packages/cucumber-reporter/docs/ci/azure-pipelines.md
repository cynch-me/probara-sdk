# Azure Pipelines

Sync the feature files on the default branch, then run the tests with the formatter. Store the token
as a secret pipeline variable named `PROBARA_API_TOKEN`.

```yaml
trigger:
  branches:
    include: [main]

pr:
  branches:
    include: [main]

variables:
  PROBARA_PROJECT: SHOP

stages:
  - stage: Sync
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - job: SyncGherkin
        pool:
          vmImage: ubuntu-latest
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: '22.x'
          - script: npx @probara/cli sync gherkin "features/**/*.feature"
            env:
              PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)

  - stage: Test
    jobs:
      - job: Cucumber
        pool:
          vmImage: ubuntu-latest
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: '22.x'
          - script: npm ci
          - script: npx cucumber-js --format @probara/cucumber-reporter
            env:
              PROBARA_API_TOKEN: $(PROBARA_API_TOKEN)
```

The `Sync` stage runs on the `main` branch only. See [configuration](../configuration.md).
