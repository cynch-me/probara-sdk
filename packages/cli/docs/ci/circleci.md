# CircleCI

Run the import as a step with `when: always`, with the token from a context or a project
environment variable.

## 1. Add the token

**Organization Settings → Contexts → Create Context** (such as `probara-reporting`), then add the
environment variable `PROBARA_API_TOKEN`. A project environment variable (**Project Settings →
Environment Variables**) works too; then drop `context:` below. The token is an app token from the
**JUnit XML** card in **Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. Add the step

A complete `.circleci/config.yml` for a Go project. The `circleci/node` orb installs Node.js
22 next to Go:

```yaml
version: 2.1

orbs:
  node: circleci/node@5

jobs:
  test:
    docker:
      - image: cimg/go:1.23
    environment:
      PROBARA_PROJECT: SHOP
    steps:
      - checkout
      - node/install:
          node-version: '22'
      - run: go install gotest.tools/gotestsum@latest
      - run:
          name: Test
          command: |
            mkdir -p reports
            gotestsum --junitfile reports/go.xml -- ./...
      - run:
          name: Report to Probara
          when: always
          command: |
            # Forked pull requests get no secrets: report nothing there.
            if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
            npx @probara/cli import junit reports/go.xml
      - store_test_results:
          path: reports

workflows:
  test:
    jobs:
      - test:
          context: probara-reporting
```

## Run it even when the tests fail

`when: always` runs the step after a failed one. The import exits 0 when tests failed, so the
job's status still comes from the test step ([exit codes](../exit-codes.md)). Append `|| true` to
the command to keep a Probara outage from failing the job.

## What CI detection fills in

With `CIRCLECI=true`:

| Field     | From                                        |
| --------- | ------------------------------------------- |
| Run name  | `CIRCLE_PROJECT_REPONAME #CIRCLE_BUILD_NUM` |
| Branch    | `CIRCLE_BRANCH` (unset for a tag build)     |
| Commit    | `CIRCLE_SHA1`                               |
| Build URL | `CIRCLE_BUILD_URL`                          |

## Fork pull requests

CircleCI does not pass project environment variables or contexts to builds of forked pull
requests, unless **Pass secrets to builds from forked pull requests** is on (leave it off). The
`if` line then turns reporting off, so those builds pass without reporting.

## Gherkin: sync and Cucumber results

cucumber-js users can report each scenario, with its attachments, at the end of the run, instead of the JSON report and the import below: add `--format @probara/cucumber-reporter` to the test command and drop the import step ([the reporter's CI guide](https://github.com/cynch-me/probara-sdk/blob/main/packages/cucumber-reporter/docs/ci/circleci.md)).

For `.feature` files kept in Git ([Gherkin](../gherkin.md)): sync them before the tests on the
default branch, and import the Cucumber JSON report after the tests on every build. Use an app token
from the **Cucumber** card in **Integrations**, so what the job sends shows **Cucumber**.

```yaml
version: 2.1

jobs:
  bdd:
    docker:
      - image: cimg/node:22.12
    environment:
      PROBARA_PROJECT: SHOP
    steps:
      - checkout
      - run: npm ci
      - when:
          condition:
            equal: [main, << pipeline.git.branch >>]
          steps:
            - run:
                name: Sync the feature files
                command: >-
                  npx @probara/cli sync gherkin "features/**/*.feature"
                  --file-url "https://github.com/acme/shop/blob/main/{path}#L{line}"
      - run:
          name: Test
          command: npx cucumber-js --format json:results/cucumber.json
      - run:
          name: Report to Probara
          when: always
          command: |
            # Forked pull requests get no secrets: report nothing there.
            if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
            npx @probara/cli import cucumber results/cucumber.json

workflows:
  bdd:
    jobs:
      - bdd:
          context: probara-reporting
```

- CircleCI does not tell the CLI where the repository is hosted, so `--file-url` gives the link
  template: `{path}` and `{line}` are filled in for each scenario. Without it, a case shows its path
  with no link.
- `import cucumber` reads the feature files of the checkout to key each result: import in the job
  that checked them out.

## See also

- [Sharded runs](sharding.md): `parallelism` into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
