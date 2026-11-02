# GitHub Actions

The reporter runs inside `npx vitest run`: give that step the token from the repository's secrets,
and the run is reported when Vitest ends. No separate report step is needed, and the token is never
printed: a problem names the variable, never its value.

## 1. Add the secret

In the repository (or organization): **Settings → Secrets and variables → Actions → New
repository secret**, named `PROBARA_API_TOKEN`, holding an app token from the **Vitest** card in
**Integrations** ([get a token](../configuration.md#get-a-token)). The project code is not a
secret: put it in `vitest.config.mts` (`projectId`) or in the workflow (`PROBARA_PROJECT`).

## 2. Give the test step the token

A complete workflow, with the reporter registered in `vitest.config.mts` as in the
[quick start](../../README.md#quick-start):

```yaml
name: Vitest

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
      - name: Run Vitest tests
        run: npx vitest run
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          # Fork pull requests get no secrets: report nothing there.
          PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
```

- **Node.js**: the reporter needs Node.js 22.12 or later.
- **Failed tests fail the step, reporting problems do not**: Vitest's exit code stays the tests'
  own ([what the reporter never does](../debugging.md#what-the-reporter-never-does-to-the-run)).
- **`npm test` works too** when your `test` script runs `vitest run`: the reporter comes from the
  config, not from the command. A `--reporter` on the command line replaces the config's reporters,
  this one included.
- **Pin the version** in `package.json` (or the lockfile), so a new release never changes a
  pipeline by surprise ([upgrading](../upgrade.md)).
- Every other setting is an option or a `PROBARA_*` variable of the step
  ([configuration](../configuration.md#options)).

## Sharded jobs: one run from the blobs

The shards write Vitest blob reports with the reporter beside `blob`, and one job merges them: the
whole pipeline is one run, every attempt and file included
([sharding](sharding.md#pattern-1-merge-the-blob-reports)). Only the merging job needs the token:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shardIndex: [1, 2, 3, 4]
        shardTotal: [4]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx vitest run --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }} --reporter=blob --reporter=@probara/vitest-reporter
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: vitest-blob-${{ matrix.shardIndex }}
          path: .vitest
          include-hidden-files: true
          retention-days: 1

  report:
    needs: test
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          pattern: vitest-blob-*
          path: .vitest
          merge-multiple: true
      - run: npx vitest --merge-reports
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
```

- `.vitest` holds Vitest 5's blobs and `attachmentsDir`; it is hidden, hence
  `include-hidden-files: true`. On Vitest 3 and 4, upload `.vitest-reports` and
  `.vitest-attachments` (one per line of `path:`), and download them to `.`.
- GitHub-hosted runners check out every job at the same path, so the merge keeps every key
  ([merge at the same path](sharding.md#merge-at-the-same-path)).
- The `report` job runs after failed shards too, and its exit code is that of the merged tests.

To have each shard report as it ends instead, create the run first and pass it to every shard:
see [sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it).

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
      - run: npx vitest run --shard=${{ matrix.shard }}/2
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
| Run name      | `GITHUB_WORKFLOW #GITHUB_RUN_NUMBER`, such as `Vitest #42`                            |
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

Workflows triggered by a pull request from a fork get empty secrets. Without the token, the
reporter says so, sends nothing, and the tests run as usual:

<!-- output: default, scenario: not-configured -->

```text
$ PROBARA_PROJECT=SHOP npx vitest run
[probara] Probara reporting is off: The API token is not set: pass apiToken or set PROBARA_API_TOKEN
```

The workflows above set `PROBARA_ENABLED` from whether the secret is there, so fork builds report
nothing and log nothing. Do not use `pull_request_target` to get the secret into a fork build: it
runs the fork's code with your secrets.

## See also

- [Sharding](sharding.md): every way to get one run for a sharded pipeline.
- [Results file](../results-file.md#in-ci): keep what could not be sent.
- [Troubleshooting](../troubleshooting.md).
