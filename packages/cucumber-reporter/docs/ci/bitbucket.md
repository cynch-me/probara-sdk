# Bitbucket Pipelines

Sync the feature files on the default branch, then run the tests with the formatter. Store the token as
a secured repository variable named `PROBARA_API_TOKEN`.

```yaml
image: node:22

definitions:
  steps:
    - step: &sync-gherkin
        name: Sync Gherkin
        script:
          - npx @probara/cli sync gherkin "features/**/*.feature"

    - step: &cucumber
        name: Cucumber
        script:
          - npm ci
          - npx cucumber-js --format @probara/cucumber-reporter

pipelines:
  default:
    - step: *cucumber
  branches:
    main:
      - step: *sync-gherkin
      - step: *cucumber
```

Set `PROBARA_PROJECT` as a repository variable, or in the `environment` of each step. The `main`
branch syncs before its tests; other branches run the tests only. See [configuration](../configuration.md).
