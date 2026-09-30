# Buildkite

Give the test step the token from your agent's secrets (an environment hook, or a secrets plugin);
the reporter runs inside `npx playwright test`.

## 1. Add the token

Expose `PROBARA_API_TOKEN` to the steps from a secret store: an agent `environment` hook that reads
it from your secrets manager, or [Buildkite secrets](https://buildkite.com/docs/pipelines/security/secrets/buildkite-secrets).
The token is an app token from the **Playwright** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A `pipeline.yml` whose parallel jobs report into one run created by a first step
([sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it)):

```yaml
env:
  PROBARA_PROJECT: SHOP

steps:
  - label: Create the Probara run
    key: create-run
    command: buildkite-agent meta-data set probara-run "$(npx @probara/cli run create)"

  - label: Playwright
    depends_on: create-run
    parallelism: 4
    command: |
      npm ci
      export PROBARA_RUN_ULID="$(buildkite-agent meta-data get probara-run)"
      npx playwright test --shard=$((BUILDKITE_PARALLEL_JOB + 1))/$BUILDKITE_PARALLEL_JOB_COUNT

  - wait: ~
    continue_on_failure: true

  - label: Close the Probara run
    command: PROBARA_RUN_ULID="$(buildkite-agent meta-data get probara-run)" npx @probara/cli run close
```

`BUILDKITE_PARALLEL_JOB` counts from 0, Playwright's shards from 1. With `BUILDKITE=true`, the run
is named `BUILDKITE_PIPELINE_SLUG #BUILDKITE_BUILD_NUMBER`, with the branch `BUILDKITE_BRANCH`, the
commit `BUILDKITE_COMMIT` and the build URL `BUILDKITE_BUILD_URL`.

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
