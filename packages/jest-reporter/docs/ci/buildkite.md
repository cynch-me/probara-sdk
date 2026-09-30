# Buildkite

Give the test step the token from your agent's secrets (an environment hook, or a secrets plugin);
the reporter runs inside `npx jest`.

## 1. Add the token

Expose `PROBARA_API_TOKEN` to the steps from a secret store: an agent `environment` hook that reads
it from your secrets manager, or [Buildkite secrets](https://buildkite.com/docs/pipelines/security/secrets/buildkite-secrets).
The token is an app token from the **Jest** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. The pipeline

A `pipeline.yml` whose parallel jobs report into one run created by a first step and closed after
them, even when they failed ([sharding](sharding.md#create-the-run-report-from-each-shard-close-it));
without `parallelism`, one step running `npx jest --ci` is enough:

```yaml
env:
  PROBARA_PROJECT: SHOP

steps:
  - label: Create the Probara run
    key: create-run
    command: |
      PROBARA_RUN_ULID="$(npx @probara/cli run create)"
      if [ -n "$$PROBARA_RUN_ULID" ]; then buildkite-agent meta-data set probara-run "$$PROBARA_RUN_ULID"; fi

  - label: Jest
    depends_on: create-run
    parallelism: 4
    command: |
      npm ci
      export PROBARA_RUN_ULID="$(buildkite-agent meta-data get probara-run)"
      npx jest --ci --shard=$((BUILDKITE_PARALLEL_JOB + 1))/$$BUILDKITE_PARALLEL_JOB_COUNT

  - wait: ~
    continue_on_failure: true

  - label: Close the Probara run
    command: PROBARA_RUN_ULID="$(buildkite-agent meta-data get probara-run)" npx @probara/cli run close
```

`buildkite-agent pipeline upload` fills in `$NAME` and `${NAME}` when it uploads the pipeline, and a
variable it does not know then, such as `BUILDKITE_PARALLEL_JOB_COUNT` that only the parallel jobs
get, becomes blank; a `$$` is left as one `$` for the job's shell (Buildkite's pipeline upload and
environment variables docs), while `$(...)` and `$((...))` are left as they are. The run is created
on a line of its own, so a failed `run create` fails the first step rather than storing a blank
ULID. With reporting off (a [fork build](#fork-pull-requests)), `run create` prints no ULID and
exits 0: there is nothing to store, and the other steps run with reporting off too.
`BUILDKITE_PARALLEL_JOB` counts from 0, Jest's shards from 1. With `BUILDKITE=true`, the run is
named `BUILDKITE_PIPELINE_SLUG #BUILDKITE_BUILD_NUMBER`, with the branch `BUILDKITE_BRANCH`, the
commit `BUILDKITE_COMMIT` and the build URL `BUILDKITE_BUILD_URL`.

## Fork pull requests

Buildkite builds pull requests from forks only if the pipeline allows it (off by default). Those
builds run on your agents, and `pipeline upload` reads the fork's own `pipeline.yml`, which also
picks the agents' queue. The fork's code runs in the job's shell as the agent's user, so on an
agent that can read the token from your secret store, the fork's code can read it too: no hook or
step keeps it out. Keep fork builds off, or keep them off those agents: their `environment` hook
refuses a build of a fork (`BUILDKITE_PULL_REQUEST_REPO` names it), and forks build only on a
separate queue or cluster whose agents cannot read the secret store:

```bash
# The environment hook of the agents that can read the token: no build of a fork runs there.
if [ -n "$BUILDKITE_PULL_REQUEST_REPO" ]; then
  case "${BUILDKITE_PULL_REQUEST_REPO#*://}" in
    github.com/acme/shop.git) ;;
    *)
      echo "Refusing a build of a fork: $BUILDKITE_PULL_REQUEST_REPO" >&2
      exit 1
      ;;
  esac
fi
export PROBARA_API_TOKEN="$(your-secrets-manager get probara-api-token)"
```

`BUILDKITE_PULL_REQUEST_REPO` is empty outside pull requests, and has been an `https://` URL since
2022 (a `git://` one before), so the hook compares it without the scheme: put your repository in
place of `github.com/acme/shop.git`. When it does not match, your own pull requests fail on these
agents too, which the first one shows. On the agents that build forks, set `PROBARA_ENABLED=false`
in their `environment` hook: the fork's tests run and `npx jest` reports nothing, and `run create`
and `run close` exit 0 without a token.

## See also

- [Sharding](sharding.md), [troubleshooting](../troubleshooting.md).
