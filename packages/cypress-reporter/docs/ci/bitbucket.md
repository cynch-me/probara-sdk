# Bitbucket Pipelines

Add the token as a secured repository variable; Bitbucket passes repository variables to every
step, so the reporter finds it in `npx cypress run`.

## 1. Add the variable

**Repository settings → Pipelines → Repository variables**: name `PROBARA_API_TOKEN`, the token as
the value, **Secured** on. The token is an app token from the **Cypress** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A `bitbucket-pipelines.yml` with the reporter registered in `cypress.config.js` as in the
[quick start](../../README.md#quick-start):

```yaml
image: cypress/browsers:latest

pipelines:
  default:
    - step:
        name: Cypress
        script:
          - npm ci
          - export PROBARA_PROJECT=SHOP
          - npx cypress run
```

## Parallel steps: one run

Parallel steps that each run part of the specs report into one run created by a first step and closed by
a last one ([sharding](sharding.md#create-the-run-report-from-each-machine-close-it)):

```yaml
image: cypress/browsers:latest

pipelines:
  default:
    - step:
        name: Create the Probara run
        script:
          - export PROBARA_PROJECT=SHOP
          - PROBARA_RUN_ULID=$(npx @probara/cli run create)
          - echo "PROBARA_RUN_ULID=$PROBARA_RUN_ULID" > probara.env
        artifacts:
          - probara.env
    - parallel:
        - step:
            name: Cart
            script:
              - npm ci
              - export PROBARA_PROJECT=SHOP $(cat probara.env)
              - npx cypress run --spec 'cypress/e2e/cart/**'
        - step:
            name: Login
            script:
              - npm ci
              - export PROBARA_PROJECT=SHOP $(cat probara.env)
              - npx cypress run --spec 'cypress/e2e/login/**'
    - step:
        name: Close the Probara run
        script:
          - export PROBARA_PROJECT=SHOP $(cat probara.env)
          - npx @probara/cli run close
```

Bitbucket skips the steps after a failed one, so a step with a failed test leaves the run open: close it in
Probara, or by hand ([if the close never ran](sharding.md#if-the-close-never-ran)).

## Forks and CI detection

Pull requests from forks get no secured variables: the reporter stays quiet there. With
`BITBUCKET_BUILD_NUMBER` set, the run is named `BITBUCKET_REPO_SLUG #BITBUCKET_BUILD_NUMBER`, with
the branch `BITBUCKET_BRANCH`, the commit `BITBUCKET_COMMIT` and a link to the pipeline
([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
