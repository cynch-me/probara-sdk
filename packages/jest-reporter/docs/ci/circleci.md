# CircleCI

Give the test step the token from a context or a project environment variable; the reporter runs
inside `npx jest`.

## 1. Add the token

**Organization Settings → Contexts → Create Context** (such as `probara-reporting`), then add the
environment variable `PROBARA_API_TOKEN`. A project environment variable (**Project Settings →
Environment Variables**) works too; then drop `context:` below. The token is an app token from the
**Jest** card in **Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The job

A `.circleci/config.yml` in a Node.js image, sharded with `parallelism` into one run created up
front ([sharding](sharding.md#create-the-run-report-from-each-shard-close-it)); without
`parallelism`, keep only the `test` job and run `npx jest --ci`:

```yaml
version: 2.1

jobs:
  create-run:
    docker:
      - image: cimg/node:22.12
    environment:
      PROBARA_PROJECT: SHOP
    steps:
      - run: |
          PROBARA_RUN_ULID=$(npx @probara/cli run create)
          echo "PROBARA_RUN_ULID=$PROBARA_RUN_ULID" > probara.env
      - persist_to_workspace:
          root: .
          paths: [probara.env]
  test:
    docker:
      - image: cimg/node:22.12
    parallelism: 4
    environment:
      PROBARA_PROJECT: SHOP
    steps:
      - checkout
      - attach_workspace:
          at: .
      - run: npm ci
      - run: |
          export $(cat probara.env)
          npx jest --ci --shard=$((CIRCLE_NODE_INDEX + 1))/$CIRCLE_NODE_TOTAL
  close-run:
    docker:
      - image: cimg/node:22.12
    environment:
      PROBARA_PROJECT: SHOP
    steps:
      - attach_workspace:
          at: .
      - run:
          when: always
          command: |
            export $(cat probara.env)
            npx @probara/cli run close

workflows:
  jest:
    jobs:
      - create-run:
          context: probara-reporting
      - test:
          context: probara-reporting
          requires: [create-run]
      - close-run:
          context: probara-reporting
          requires:
            - test: [success, failed]
```

- `CIRCLE_NODE_INDEX` counts from 0, Jest's shards from 1.
- CircleCI does not pass contexts or project variables to builds of forked pull requests (unless
  **Pass secrets to builds from forked pull requests** is on: leave it off). Without the token the
  reporter stays quiet and `run create` prints nothing.

With `CIRCLECI=true`, the run is named `CIRCLE_PROJECT_REPONAME #CIRCLE_BUILD_NUM`, with the
branch `CIRCLE_BRANCH`, the commit `CIRCLE_SHA1` and the build URL `CIRCLE_BUILD_URL`.

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
