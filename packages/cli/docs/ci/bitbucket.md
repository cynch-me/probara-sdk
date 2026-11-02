# Bitbucket Pipelines

Run the import in the step's `after-script`, which runs even when the script failed.

## 1. Add the variable

**Repository settings → Pipelines → Repository variables**: name `PROBARA_API_TOKEN`, the token as
the value, **Secured** checked. Add `PROBARA_PROJECT` the same way (not secured), or set it in the
file. The token is an app token from the **JUnit XML** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. Add the step

A complete `bitbucket-pipelines.yml` for a Jest project:

```yaml
image: node:22

pipelines:
  default:
    - step:
        name: Test
        caches:
          - node
        script:
          - npm ci
          - export JEST_JUNIT_OUTPUT_DIR=reports JEST_JUNIT_ADD_FILE_ATTRIBUTE=true
          - npx jest --ci --reporters=default --reporters=jest-junit
        after-script:
          # Builds without the secured variable (such as forks) report nothing.
          - |
            if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
            PROBARA_PROJECT=SHOP npx @probara/cli import junit reports/junit.xml
```

## Run it even when the tests fail

`after-script` runs whether `script` passed or failed. Its exit code does **not** change the
step's result: a failed import shows in the log but never fails the build. To fail the build when
reporting fails, run the import at the end of `script` instead, after the tests, with the tests'
exit code kept:

```yaml
script:
  - npm ci
  - export JEST_JUNIT_OUTPUT_DIR=reports JEST_JUNIT_ADD_FILE_ATTRIBUTE=true
  - npx jest --ci --reporters=default --reporters=jest-junit || status=$?
  - PROBARA_PROJECT=SHOP npx @probara/cli import junit reports/junit.xml
  - exit ${status:-0}
```

## What CI detection fills in

With `BITBUCKET_BUILD_NUMBER` set:

| Field     | From                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| Run name  | `BITBUCKET_REPO_SLUG #BITBUCKET_BUILD_NUMBER`                                             |
| Branch    | `BITBUCKET_BRANCH`                                                                        |
| Commit    | `BITBUCKET_COMMIT`                                                                        |
| Build URL | `https://bitbucket.org/BITBUCKET_REPO_FULL_NAME/pipelines/results/BITBUCKET_BUILD_NUMBER` |

For a self-hosted Bitbucket Data Center the build URL points at bitbucket.org: set
`PROBARA_BUILD_URL` yourself.

## Fork pull requests

Pipelines of a fork run in the fork's repository, with the fork's variables, so they have no
token. The `if` line turns reporting off there, and the step passes.

## Gherkin: sync and Cucumber results

For `.feature` files kept in Git ([Gherkin](../gherkin.md)): sync them before the tests on the
default branch, and import the Cucumber JSON report in `after-script` on every build. The `main`
pipeline replaces `default` for that branch, so it repeats the test step with the sync before it:

```yaml
image: node:22

pipelines:
  default:
    - step:
        name: Test
        caches:
          - node
        script:
          - npm ci
          - npx cucumber-js --format json:results/cucumber.json
        after-script:
          # Builds without the secured variable (such as forks) report nothing.
          - |
            if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
            PROBARA_PROJECT=SHOP npx @probara/cli import cucumber results/cucumber.json
  branches:
    main:
      - step:
          name: Sync and test
          caches:
            - node
          script:
            - npm ci
            - PROBARA_PROJECT=SHOP npx @probara/cli sync gherkin "features/**/*.feature"
            - npx cucumber-js --format json:results/cucumber.json
          after-script:
            - PROBARA_PROJECT=SHOP npx @probara/cli import cucumber results/cucumber.json
```

- The sync links each case to its file and line on Bitbucket by itself.
- `after-script` runs in the same clone, so `import cucumber` finds the feature files it reads to
  key each result.

## See also

- [Sharded runs](sharding.md): `parallel` steps into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
