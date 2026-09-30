# Bitbucket Pipelines

Add the token as a secured repository variable; Bitbucket passes repository variables to every
step, so the reporter finds it in `npx playwright test`.

## 1. Add the variable

**Repository settings → Pipelines → Repository variables**: name `PROBARA_API_TOKEN`, the token as
the value, **Secured** on. The token is an app token from the **Playwright** card in
**Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A `bitbucket-pipelines.yml` in Playwright's image, with two parallel shards that merge their blob
reports into one run ([sharding](sharding.md#pattern-1-merge-the-blob-reports)); without sharding,
keep one step running `npx playwright test`:

```yaml
image: mcr.microsoft.com/playwright:v1.56.1-noble

pipelines:
  default:
    - parallel:
        - step:
            name: Shard 1
            script:
              - npm ci
              - npx playwright test --shard=1/2
            artifacts:
              - blob-report/**
        - step:
            name: Shard 2
            script:
              - npm ci
              - npx playwright test --shard=2/2
            artifacts:
              - blob-report/**
    - step:
        name: Report to Probara
        script:
          - npm ci
          - export PROBARA_PROJECT=SHOP
          - npx playwright merge-reports --reporter @probara/playwright-reporter ./blob-report
```

Pull requests from forks get no secured variables: the reporter stays quiet there. With
`BITBUCKET_BUILD_NUMBER` set, the run is named `BITBUCKET_REPO_SLUG #BITBUCKET_BUILD_NUMBER`, with
the branch `BITBUCKET_BRANCH`, the commit `BITBUCKET_COMMIT` and a link to the pipeline
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
