# GitHub Actions

Run the import as a step after the tests, with `if: always()` so it also runs when they fail.

> Until `@probara/cli` is published, replace `npx @probara/cli` with a build of this repository
> ([how](../../README.md#use-it-before-it-is-published)).

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
- **Pin the version** once published (`npx @probara/cli@0.1.0`), so a new release never changes a
  pipeline by surprise ([upgrading](../upgrade.md)).

## Run it even when the tests fail

A failing test step stops the job; `if: always()` runs the import anyway. It also runs when the
workflow is cancelled; use `if: ${{ !cancelled() }}` to skip it then. The import exits 0 when tests
failed, so the job's status still comes from the test step
([exit codes](../exit-codes.md)).

## What CI detection fills in

With `GITHUB_ACTIONS=true`, the run gets these values unless a flag or a `PROBARA_*` variable sets
them:

| Field     | From                                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| Run name  | `GITHUB_WORKFLOW #GITHUB_RUN_NUMBER`, such as `CI #42`                                |
| Branch    | `GITHUB_HEAD_REF` (the pull request's branch), else `GITHUB_REF_NAME`; none for a tag |
| Commit    | `GITHUB_SHA`                                                                          |
| Build URL | `GITHUB_SERVER_URL/GITHUB_REPOSITORY/actions/runs/GITHUB_RUN_ID`                      |

On `pull_request` events `GITHUB_SHA` is the merge commit GitHub made, not the branch's last
commit. To record the latter, add `PROBARA_COMMIT: ${{ github.event.pull_request.head.sha }}`.

## Fork pull requests

Workflows triggered by a pull request from a fork get empty secrets. Without a token the CLI exits
2, so the workflow above sets `PROBARA_ENABLED` from whether the secret is there: fork builds
report nothing and pass. Do not use `pull_request_target` to get the secret into a fork build: it
runs the fork's code with your secrets.

## See also

- [Sharded runs](sharding.md): matrix jobs into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
