# GitLab CI

Sync the feature files on the default branch, then run the tests with the formatter. Store the token
as a masked CI/CD variable named `PROBARA_API_TOKEN`.

```yaml
stages:
  - sync
  - test

sync-gherkin:
  stage: sync
  image: node:22
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npx @probara/cli sync gherkin "features/**/*.feature"

test:
  stage: test
  image: node:22
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx cucumber-js --format @probara/cucumber-reporter
```

The `sync-gherkin` job runs on the default branch only. The formatter reads the same keys the sync
wrote, so the results of every branch land on the cases of the default branch. See
[configuration](../configuration.md).
