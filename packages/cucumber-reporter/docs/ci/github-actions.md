# GitHub Actions

Sync the feature files on the default branch, then run the tests with the formatter. The token is a
repository secret named `PROBARA_API_TOKEN`.

```yaml
name: BDD

on:
  push:
    branches: [main]
  pull_request:

jobs:
  sync-gherkin:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx @probara/cli sync gherkin "features/**/*.feature"

  test:
    runs-on: ubuntu-latest
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx cucumber-js --format @probara/cucumber-reporter
```

The `sync-gherkin` job runs on the default branch only, so Git holds the cases before the pull requests
run their tests. Use `--format-options` or `cucumber.js` for the project of a run that is not
`PROBARA_PROJECT`. See [configuration](../configuration.md).

## Parallel jobs: one run, closed by the final job

In GitHub Actions the run's source names the workflow run: its repository, run id and attempt.
Every job that reports without `run.ulid` goes into the same run, and the first one to
report creates it. A run is still closed at the end of each job by default, so the parallel jobs opt
out with `PROBARA_CLOSE_RUN: false` (or `closeRun: false` under `formatOptions.probara`), and a final
job closes the run with `probara run close`, which needs no ULID there: `needs` makes it wait for
every test job, and `if: always()` runs it when they fail.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        area: [cart, checkout]
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx cucumber-js --format @probara/cucumber-reporter "features/${{ matrix.area }}/**/*.feature"
        env:
          # A job leaves the run open for the others.
          PROBARA_CLOSE_RUN: false

  close-run:
    needs: test
    if: always()
    runs-on: ubuntu-latest
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx @probara/cli run close
```

- **A job after the close** is refused (409 `ci_run_closed`): the formatter logs why, sends nothing
  more, and the tests keep their own exit code. Keep every reporting job in `needs`.
- **A re-run** of the workflow is another attempt: it reports into a run of its own.
- **One job only** needs neither: its run is closed at the end, as anywhere else.

## A run launched from Probara

When Probara starts the workflow for one of its runs, it passes the run's ULID as the workflow
input `probara_run_id`. Expose it as `PROBARA_RUN_ULID`, and every job reports into that run
instead of the run of the workflow run; the final job's `probara run close` closes it too. Add the
input under `on`, next to `push`, and the variable at the top level of the workflow:

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
| Run name      | `GITHUB_WORKFLOW #GITHUB_RUN_NUMBER`, such as `BDD #42`                               |
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
