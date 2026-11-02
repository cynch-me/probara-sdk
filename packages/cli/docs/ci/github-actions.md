# GitHub Actions

Run the import as a step after the tests, with `if: always()` so it also runs when they fail.

## 1. Add the secret

In the repository (or organization): **Settings → Secrets and variables → Actions → New
repository secret**, named `PROBARA_API_TOKEN`, holding an app token from the **JUnit XML** card in
**Integrations** ([get a token](../configuration.md#get-a-token)). The project code is not a
secret: put it in the workflow, or in a variable (`vars.PROBARA_PROJECT`).

## 2. Add the step

A complete workflow for a Jest project:

```yaml
name: CI

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
      - name: Test
        run: npx jest --ci --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: reports
          JEST_JUNIT_ADD_FILE_ATTRIBUTE: 'true'
      - name: Report to Probara
        if: always()
        run: npx @probara/cli import junit reports/junit.xml
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          # Fork pull requests get no secrets: report nothing there instead of failing.
          PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
```

- **Node.js**: the import needs Node.js 22.12 or later. Keep `actions/setup-node` in Python, Java
  or Go workflows too: the runner's preinstalled Node may be older.
- **Other frameworks**: change the test step and the path, as shown in
  [JUnit mapping](../junit.md#dialects): `reports/pytest.xml`, `target/surefire-reports`,
  `reports/go.xml`...
- **Pin the version** (`npx @probara/cli@0.2.0`), so a new release never changes a pipeline by
  surprise ([upgrading](../upgrade.md)).

## Run it even when the tests fail

A failing test step stops the job; `if: always()` runs the import anyway. It also runs when the
workflow is cancelled; use `if: ${{ !cancelled() }}` to skip it then. The import exits 0 when tests
failed, so the job's status still comes from the test step
([exit codes](../exit-codes.md)).

## Parallel jobs: one run, closed by the final job

In GitHub Actions the run's source names the workflow run: its repository, run id and attempt.
Every job that imports without a run ULID goes into the same run, the first one to report creates it. A
run is still closed at the end of the job by default, so the parallel jobs opt out with
`PROBARA_CLOSE_RUN: false` (or `--no-close-run`), and a final job closes the run with `probara run close`, which needs
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
      - run: npx jest --ci --shard=${{ matrix.shard }}/2 --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: reports
      - if: always()
        run: npx @probara/cli import junit reports/junit.xml
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

- **A job after the close** is refused (409 `ci_run_closed`): its import exits 1 and names the cause; nothing of it is recorded. Keep every reporting job in
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

With `GITHUB_ACTIONS=true`, the run gets these values unless a flag or a `PROBARA_*` variable sets
them:

| Field         | From                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| Run name      | `GITHUB_WORKFLOW #GITHUB_RUN_NUMBER`, such as `CI #42`                                |
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

Workflows triggered by a pull request from a fork get empty secrets. Without a token the CLI exits
2, so the workflow above sets `PROBARA_ENABLED` from whether the secret is there: fork builds
report nothing and pass. Do not use `pull_request_target` to get the secret into a fork build: it
runs the fork's code with your secrets.

## Gherkin: sync and Cucumber results

cucumber-js users can report each scenario, with its attachments, at the end of the run, instead of the JSON report and the import below: add `--format @probara/cucumber-reporter` to the test command and drop the import step ([the reporter's CI guide](https://github.com/cynch-me/probara-sdk/blob/main/packages/cucumber-reporter/docs/ci/github-actions.md)).

For `.feature` files kept in Git ([Gherkin](../gherkin.md)): sync them before the tests on the
default branch, and import the Cucumber JSON report after the tests on every build. Use an app token
from the **Cucumber** card in **Integrations**, so what the job sends shows **Cucumber**.

```yaml
name: BDD

on:
  push:
    branches: [main]
  pull_request:

jobs:
  bdd:
    runs-on: ubuntu-latest
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
      # Fork pull requests get no secrets: report nothing there instead of failing.
      PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - name: Sync the feature files
        if: github.ref == 'refs/heads/main'
        run: npx @probara/cli sync gherkin "features/**/*.feature"
      - name: Test
        run: npx cucumber-js --format json:results/cucumber.json
      - name: Report to Probara
        if: always()
        run: npx @probara/cli import cucumber results/cucumber.json
```

- The sync runs on `main` only. A pull request's scenarios are not merged yet, so they change no
  case; its results are still reported.
- `import cucumber` reads the feature files of the checkout to key each result: import in the job
  that checked them out.
- The sync links each case to its file and line on GitHub by itself.

## See also

- [Sharded runs](sharding.md): matrix jobs into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
