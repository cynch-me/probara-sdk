# Bitbucket Pipelines

Add the token as a secured repository variable; Bitbucket passes repository variables to every
step, so the reporter finds it in `npx jest`.

## 1. Add the variable

**Repository settings → Pipelines → Repository variables**: name `PROBARA_API_TOKEN`, the token as
the value, **Secured** on. The token is an app token from the **Jest** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A `bitbucket-pipelines.yml` with the reporter registered in `jest.config.js` as in the
[quick start](../../README.md#quick-start):

```yaml
image: node:22

pipelines:
  default:
    - step:
        name: Jest
        script:
          - npm ci
          - export PROBARA_PROJECT=SHOP
          - npx jest --ci
```

## Parallel steps: one run

Parallel steps that each run a `--shard` report into one run created by a first step and closed by
a last one ([sharding](sharding.md#create-the-run-report-from-each-shard-close-it)):

```yaml
image: node:22

pipelines:
  default:
    - step:
        name: Create the Probara run
        script:
          - export PROBARA_PROJECT=SHOP
          - echo "PROBARA_RUN_ULID=$(npx @probara/cli run create)" > probara.env
        artifacts:
          - probara.env
    - parallel:
        - step:
            name: Shard 1
            script:
              - npm ci
              - export PROBARA_PROJECT=SHOP $(cat probara.env)
              - npx jest --ci --shard=1/2
        - step:
            name: Shard 2
            script:
              - npm ci
              - export PROBARA_PROJECT=SHOP $(cat probara.env)
              - npx jest --ci --shard=2/2
    - step:
        name: Close the Probara run
        script:
          - export PROBARA_PROJECT=SHOP $(cat probara.env)
          - npx @probara/cli run close
```

Bitbucket skips the steps after a failed one, so a failing shard leaves the run open: close it in
Probara, or by hand ([if the close never ran](sharding.md#if-the-close-never-ran)).

## Forks and CI detection

Pull requests from forks get no secured variables: the reporter stays quiet there. With
`BITBUCKET_BUILD_NUMBER` set, the run is named `BITBUCKET_REPO_SLUG #BITBUCKET_BUILD_NUMBER`, with
the branch `BITBUCKET_BRANCH`, the commit `BITBUCKET_COMMIT` and a link to the pipeline
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
