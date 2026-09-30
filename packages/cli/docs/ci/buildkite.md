# Buildkite

Run the import as its own step that depends on the tests with `allow_dependency_failure`, so it
runs even when they fail.

## 1. Provide the token

Buildkite runs steps on your agents, so the token comes from the agent side. Either:

- store it as a [Buildkite secret](https://buildkite.com/docs/pipelines/security/secrets/buildkite-secrets)
  named `probara_api_token` and export it in the step (shown below), or
- export `PROBARA_API_TOKEN` from an agent `environment` hook, or read it from your secrets
  manager there.

Buildkite redacts the values of its secrets from the build log. The token is an app token from the
**JUnit XML** card in **Integrations** ([get a token](../configuration.md#get-a-token)).

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
builds run on your agents, as the agent's user, and the fork's own `pipeline.yml` picks the queue,
so the fork's code can read any secret its agent can read. Keep them off, or keep forks off the
agents that can read the token: their `environment` hook refuses (`exit 1`) a build whose
`BUILDKITE_PULL_REQUEST_REPO` is not your repository (compare it without the scheme: it has been an
`https://` URL since 2022), and forks build only on a separate queue or cluster whose agents cannot
read the secret store. There, set `PROBARA_ENABLED=false`, so the import reports nothing.

## See also

- [Sharded runs](sharding.md): `parallelism` into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
