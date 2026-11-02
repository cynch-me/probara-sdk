# Buildkite

Sync the feature files on the default branch, then run the tests with the formatter. Store the token in
the pipeline's secrets as `PROBARA_API_TOKEN`, for example from your secrets plugin.

```yaml
steps:
  - label: ':probara: Sync Gherkin'
    branches: 'main'
    command: npx @probara/cli sync gherkin "features/**/*.feature"
    env:
      PROBARA_PROJECT: SHOP

  - label: ':cucumber: Tests'
    command:
      - npm ci
      - npx cucumber-js --format @probara/cucumber-reporter
    env:
      PROBARA_PROJECT: SHOP
```

The sync step runs on the `main` branch only. A Buildkite `command` runs each line in order. See
[configuration](../configuration.md).
