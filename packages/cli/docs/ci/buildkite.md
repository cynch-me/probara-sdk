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

## Gherkin: sync and Cucumber results

cucumber-js users can report each scenario, with its attachments, at the end of the run, instead of the JSON report and the import below: add `--format @probara/cucumber-reporter` to the test command and drop the import step ([the reporter's CI guide](https://github.com/cynch-me/probara-sdk/blob/main/packages/cucumber-reporter/docs/ci/buildkite.md)).

For `.feature` files kept in Git ([Gherkin](../gherkin.md)): sync them before the tests on the
default branch, and import the Cucumber JSON report after the tests on every build. Use an app token
from the **Cucumber** card in **Integrations**, so what the job sends shows **Cucumber**.

```yaml
steps:
  - label: 'Sync feature files'
    if: build.branch == pipeline.default_branch
    env:
      PROBARA_PROJECT: SHOP
    command: |
      PROBARA_API_TOKEN=$(buildkite-agent secret get probara_api_token)
      export PROBARA_API_TOKEN
      npx @probara/cli sync gherkin "features/**/*.feature" \
        --file-url "https://github.com/acme/shop/blob/main/{path}#L{line}"

  - wait

  - label: 'Test'
    key: test
    command: |
      npm ci
      npx cucumber-js --format json:results/cucumber.json
    artifact_paths: 'results/*.json'

  - label: 'Report to Probara'
    depends_on: test
    allow_dependency_failure: true
    env:
      PROBARA_PROJECT: SHOP
    command: |
      buildkite-agent artifact download "results/*.json" .
      PROBARA_API_TOKEN=$(buildkite-agent secret get probara_api_token)
      export PROBARA_API_TOKEN
      npx @probara/cli import cucumber results/cucumber.json
```

- Buildkite does not tell the CLI where the repository is hosted, so `--file-url` gives the link
  template: `{path}` and `{line}` are filled in for each scenario. Without it, a case shows its path
  with no link.
- Each step checks out the repository, so the report step has the feature files `import cucumber`
  reads to key each result.

## See also

- [Sharded runs](sharding.md): `parallelism` into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
