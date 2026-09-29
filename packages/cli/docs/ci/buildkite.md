# Buildkite

Run the import as its own step that depends on the tests with `allow_dependency_failure`, so it
runs even when they fail.

> Until `@probara/cli` is published, replace `npx @probara/cli` with a build of this repository
> ([how](../../README.md#use-it-before-it-is-published)).

## 1. Provide the token

Buildkite runs steps on your agents, so the token comes from the agent side. Either:

- store it as a [Buildkite secret](https://buildkite.com/docs/pipelines/security/secrets/buildkite-secrets)
  named `probara_api_token` and export it in the step (shown below), or
- export `PROBARA_API_TOKEN` from an agent `environment` hook, or read it from your secrets
  manager there.

Buildkite redacts the values of its secrets from the build log.

## 2. Add the steps

A complete `.buildkite/pipeline.yml` for a pytest project. The agent needs Node.js 22.12 or later
(or run the step in a `node:22` container with the Docker plugin):

```yaml
steps:
  - label: 'Test'
    key: test
    command: pytest --junitxml=reports/pytest.xml
    artifact_paths: 'reports/*.xml'

  - label: 'Report to Probara'
    depends_on: test
    allow_dependency_failure: true
    env:
      PROBARA_PROJECT: SHOP
    command: |
      buildkite-agent artifact download "reports/*.xml" .
      PROBARA_API_TOKEN=$(buildkite-agent secret get probara_api_token)
      export PROBARA_API_TOKEN
      npx @probara/cli import junit reports/pytest.xml
```

## Run it even when the tests fail

`allow_dependency_failure: true` runs the step after a failed `test` step. The import exits 0 when
tests failed, so the build's status still comes from the test step
([exit codes](../exit-codes.md)). Add `soft_fail: true` to the step to keep a Probara outage from
failing the build.

## What CI detection fills in

With `BUILDKITE=true`:

| Field     | From                                                       |
| --------- | ---------------------------------------------------------- |
| Run name  | `BUILDKITE_PIPELINE_SLUG #BUILDKITE_BUILD_NUMBER`          |
| Branch    | `BUILDKITE_BRANCH`; none for a tag build (`BUILDKITE_TAG`) |
| Commit    | `BUILDKITE_COMMIT`                                         |
| Build URL | `BUILDKITE_BUILD_URL`                                      |

## Fork pull requests

Buildkite builds pull requests from forks only if the pipeline allows it (off by default). Those
builds run on your agents, with their hooks and access to secrets. Keep them off, or skip
reporting when `BUILDKITE_PULL_REQUEST_REPO` is not your repository: set `PROBARA_ENABLED=false` in
that case, before the import.

## See also

- [Sharded runs](sharding.md): `parallelism` into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
