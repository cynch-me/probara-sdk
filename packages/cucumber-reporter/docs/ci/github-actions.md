# GitHub Actions

Sync the feature files on the default branch, then run the tests with the formatter. The token is a
repository secret named `PROBARA_API_TOKEN`.

```yaml
name: BDD

on:
  push:
    branches: [main]
  pull_request:

jobs:
  sync-gherkin:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx @probara/cli sync gherkin "features/**/*.feature"

  test:
    runs-on: ubuntu-latest
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx cucumber-js --format @probara/cucumber-reporter
```

The `sync-gherkin` job runs on the default branch only, so Git holds the cases before the pull requests
run their tests. Use `--format-options` or `cucumber.js` for the project of a run that is not
`PROBARA_PROJECT`. See [configuration](../configuration.md).
