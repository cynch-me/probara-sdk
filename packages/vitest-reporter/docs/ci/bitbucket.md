# Bitbucket Pipelines

Add the token as a secured repository variable; Bitbucket passes repository variables to every
step, so the reporter finds it in `npx vitest run`, reports the run when Vitest ends, and never
prints it.

## 1. Add the variable

**Repository settings → Pipelines → Repository variables**: name `PROBARA_API_TOKEN`, the token as
the value, **Secured** on. The token is an app token from the **Vitest** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A `bitbucket-pipelines.yml` with the reporter registered in `vitest.config.mts` as in the
[quick start](../../README.md#quick-start):

```yaml
image: node:22

pipelines:
  default:
    - step:
        name: Vitest
        script:
          - npm ci
          - export PROBARA_PROJECT=SHOP
          - npx vitest run
```

Failed tests fail the step, reporting problems do not
([what the reporter never does](../debugging.md#what-the-reporter-never-does-to-the-run)).
Every other setting is an option or a `PROBARA_*` variable of the step
([configuration](../configuration.md#options)).

## Parallel steps: one run

Parallel steps that each run a `--shard` report into one run created by a first step and closed by
a last one ([sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it)):

```yaml
image: node:22

pipelines:
  default:
    - step:
        name: Create the Probara run
        script:
          # Builds without the secured variable (such as forks) report nothing.
          - if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
          - export PROBARA_PROJECT=SHOP
          - PROBARA_RUN_ULID=$(npx @probara/cli run create)
          - echo "PROBARA_RUN_ULID=$PROBARA_RUN_ULID" > probara.env
        artifacts:
          - probara.env
    - parallel:
        - step:
            name: Shard 1
            script:
              - if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
              - npm ci
              - export PROBARA_PROJECT=SHOP $(cat probara.env)
              - npx vitest run --shard=1/2
        - step:
            name: Shard 2
            script:
              - if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
              - npm ci
              - export PROBARA_PROJECT=SHOP $(cat probara.env)
              - npx vitest run --shard=2/2
    - step:
        name: Close the Probara run
        script:
          - if [ -z "$PROBARA_API_TOKEN" ]; then export PROBARA_ENABLED=false; fi
          - export PROBARA_PROJECT=SHOP $(cat probara.env)
          - npx @probara/cli run close
```

Each shard sends its results when it ends, failed tests included. Bitbucket skips the steps after
a failed one, so a shard with failed tests leaves the run open: close it in Probara, or by hand
([if the close never ran](sharding.md#if-the-close-never-ran)). For the same reason this guide does
not merge blob reports: the merging step would not run after a shard with failed tests, and none
of the shards would be reported.

## Forks and CI detection

Pipelines of a fork run in the fork's repository, with the fork's variables, so they have no token.
The `if` line of each step turns reporting off there: `run create` prints no ULID and exits 0, the
shards report nothing, and `run close` exits 0. Without it, `run create` exits 2 for the missing
token. In the single-step pipeline, the reporter only logs that the token is not set.

With `BITBUCKET_BUILD_NUMBER` set, the run is named `BITBUCKET_REPO_SLUG #BITBUCKET_BUILD_NUMBER`,
with the branch `BITBUCKET_BRANCH`, the commit `BITBUCKET_COMMIT` and a link to the pipeline
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
