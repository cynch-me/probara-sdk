# CircleCI

Sync the feature files on the default branch, then run the tests with the formatter. Store the token
in a project environment variable named `PROBARA_API_TOKEN`.

```yaml
version: 2.1

jobs:
  sync-gherkin:
    docker:
      - image: cimg/node:22.12
    environment:
      PROBARA_PROJECT: SHOP
    steps:
      - checkout
      - run: npx @probara/cli sync gherkin "features/**/*.feature"

  test:
    docker:
      - image: cimg/node:22.12
    environment:
      PROBARA_PROJECT: SHOP
    steps:
      - checkout
      - run: npm ci
      - run: npx cucumber-js --format @probara/cucumber-reporter

workflows:
  build:
    jobs:
      - sync-gherkin:
          filters:
            branches:
              only: main
      - test
```

The `sync-gherkin` job runs on the default branch only. See [configuration](../configuration.md).
