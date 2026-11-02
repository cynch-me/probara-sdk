# GitHub Actions

The reporter runs inside `npx jest`: give that step the token, and every test is reported as its
file ends. No separate report step is needed.

## 1. Add the secret

In the repository (or organization): **Settings → Secrets and variables → Actions → New
repository secret**, named `PROBARA_API_TOKEN`, holding an app token from the **Jest** card in
**Integrations** ([get a token](../configuration.md#get-a-token)). The project code is not a
secret: put it in `jest.config.js` (`projectId`) or in the workflow (`PROBARA_PROJECT`).

## 2. Give the test step the token

A complete workflow, with the reporter registered in `jest.config.js` as in the
[quick start](../../README.md#quick-start):

```yaml
name: Jest

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - name: Run Jest tests
        run: npx jest --ci
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
```

- **Node.js**: the reporter needs Node.js 22.12 or later, like the Jest run it is part of.
- **Failed tests fail the step, reporting problems do not**: Jest's exit code stays the tests' own
  ([reporting never breaks your test run](../../README.md#reporting-never-breaks-your-test-run)).
- **`npm test` works too** when your `test` script runs `jest`: the reporter comes from the config,
  not from the command.
- **Pin the version** in `package.json` (or the lockfile), so a new release never changes a
  pipeline by surprise ([upgrading](../upgrade.md)).

## Sharded jobs: one run

A matrix of `--shard` jobs makes one run per shard unless they share one: create it in a first
job, pass its ULID to every shard, and close it in a last job that runs even after failed shards.
The complete workflow is in [sharding](sharding.md#github-actions).

## Parallel jobs: one run, closed by the final job

In GitHub Actions the run's source names the workflow run: its repository, run id and attempt.
Every job that reports without `run.ulid` goes into the same run, the first one to report creates it. A
run is still closed at the end of the job by default, so the parallel jobs opt out with
`PROBARA_CLOSE_RUN: false` (or `closeRun: false`), and a final job closes the run with `probara run close`, which needs
no ULID there: `needs` makes it wait for every test job, and `if: always()` runs it when they fail.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx jest --ci --shard=${{ matrix.shard }}/2
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          # A shard leaves the run open for the others.
          PROBARA_CLOSE_RUN: false

  probara:
    needs: test
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx @probara/cli run close
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
```

- **A job after the close** is refused (409 `ci_run_closed`): the reporter logs why, sends nothing more, and the tests keep their own exit code. Keep every reporting job in
  `needs`.
- **A re-run** of the workflow is another attempt: it reports into a run of its own.
- **One job only** needs neither: its run is closed at the end, as anywhere else.

## A run launched from Probara

When Probara starts the workflow for one of its runs, it passes the run's ULID as the workflow
input `probara_run_id`. Expose it as `PROBARA_RUN_ULID`, and every job reports into that run
instead of the run of the workflow run; the final job's `probara run close` closes it too:

```yaml
on:
  workflow_dispatch:
    inputs:
      probara_run_id:
        description: The Probara run to report into
        required: false

env:
  PROBARA_RUN_ULID: ${{ inputs.probara_run_id }}
```

## What CI detection fills in

With `GITHUB_ACTIONS=true`, the run gets these values unless an option or a `PROBARA_*` variable
sets them:

| Field         | From                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| Run name      | `GITHUB_WORKFLOW #GITHUB_RUN_NUMBER`, such as `Jest #42`                              |
| Branch        | `GITHUB_HEAD_REF` (the pull request's branch), else `GITHUB_REF_NAME`; none for a tag |
| Commit        | `GITHUB_SHA`                                                                          |
| Build URL     | `GITHUB_SERVER_URL/GITHUB_REPOSITORY/actions/runs/GITHUB_RUN_ID`                      |
| Repository    | `GITHUB_REPOSITORY`                                                                   |
| Commit author | `GITHUB_ACTOR`                                                                        |
| Pull request  | `<n>` of `GITHUB_REF` `refs/pull/<n>/merge`                                           |
| Workflow      | `GITHUB_WORKFLOW`                                                                     |
| CI run        | `GITHUB_RUN_ID`, attempt `GITHUB_RUN_ATTEMPT`                                         |
| CI job        | `GITHUB_JOB`                                                                          |

On `pull_request` events `GITHUB_SHA` is the merge commit GitHub made, not the branch's last
commit. To record the latter, add `PROBARA_COMMIT: ${{ github.event.pull_request.head.sha }}`.
In GitHub Actions the commit must be a 7 to 40 character hex SHA; another value is left out
with a warning.

## Fork pull requests

Workflows triggered by a pull request from a fork get empty secrets. Without a token the reporter
stays off and quiet, so fork builds run their tests and report nothing, with no extra setting. Do
not use `pull_request_target` to get the secret into a fork build: it runs the fork's code with
your secrets.

## See also

- [Sharding](sharding.md): one run for a sharded pipeline.
- [Results file](../results-file.md): keep what could not be sent.
- [Troubleshooting](../troubleshooting.md).
