# CircleCI

Give the test step the token from a context or a project environment variable; the reporter runs
inside `npx vitest run`, reports the run when Vitest ends, and never prints the token.

## 1. Add the token

**Organization Settings → Contexts → Create Context** (such as `probara-reporting`), then add the
environment variable `PROBARA_API_TOKEN`. A project environment variable (**Project Settings →
Environment Variables**) works too; then drop `context:` below. The token is an app token from the
**Vitest** card in **Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The job

A `.circleci/config.yml` in a Node.js image, sharded with `parallelism` into one run created up
front ([sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it)); without
`parallelism`, keep only the `test` job and run `npx vitest run`:

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
          # Forked pull requests get no secrets: report nothing there.
          if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
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
          if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
          export $(cat probara.env)
          npx vitest run --shard=$((CIRCLE_NODE_INDEX + 1))/$CIRCLE_NODE_TOTAL
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
            if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
            export $(cat probara.env)
            npx @probara/cli run close

workflows:
  vitest:
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

- `CIRCLE_NODE_INDEX` counts from 0, Vitest's shards from 1.
- Each shard sends its results when it ends, into the run of `run create`; `close-run` closes it
  after failed shards too. Failed tests fail their node, reporting problems do not
  ([what the reporter never does](../debugging.md#what-the-reporter-never-does-to-the-run)).
- Every other setting is an option or a `PROBARA_*` variable of the job
  ([configuration](../configuration.md#options)).
- CircleCI does not pass contexts or project variables to builds of forked pull requests (unless
  **Pass secrets to builds from forked pull requests** is on: leave it off). The first line of each
  step turns reporting off there: `run create` prints no ULID and exits 0, the shards report
  nothing, and `run close` exits 0. Without that line, `run create` exits 2 for the missing token.

With `CIRCLECI=true`, the run is named `CIRCLE_PROJECT_REPONAME #CIRCLE_BUILD_NUM`, with the
branch `CIRCLE_BRANCH`, the commit `CIRCLE_SHA1` and the build URL `CIRCLE_BUILD_URL`.

## See also

- [Sharding](sharding.md): the blob reports, merged into one run, are the other way.
- [Troubleshooting](../troubleshooting.md).
