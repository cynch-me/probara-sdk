# GitHub Actions

The reporter runs inside `npx cypress run`: give that step the token, and every test is reported
when the run ends. No separate report step is needed.

## 1. Add the secret

In the repository (or organization): **Settings → Secrets and variables → Actions → New
repository secret**, named `PROBARA_API_TOKEN`, holding an app token from the **Cypress** card in
**Integrations** ([get a token](../configuration.md#get-a-token)). The project code is not a
secret: put it in `cypress.config.js` (`projectId`) or in the workflow (`PROBARA_PROJECT`).

## 2. Give the test step the token

A complete workflow, with the reporter registered in `cypress.config.js` as in the
[quick start](../../README.md#quick-start):

```yaml
name: Cypress

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
      - name: Run Cypress tests
        run: npx cypress run
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
```

- **Node.js**: the plugin runs on the Node.js that starts `cypress`, which needs to be 22.12 or
  later ([Cypress and Node.js versions](../upgrade.md#cypress-and-nodejs-versions)).
- **Failed tests fail the step, reporting problems do not**: Cypress's exit code stays the number of
  its failed tests
  ([reporting never breaks your test run](../../README.md#reporting-never-breaks-your-test-run)).
- **`cypress-io/github-action` works too**: it runs `cypress run`, and the reporter comes from the
  config, not from the command. Give its step the same `env`.
- **Pin the version** in `package.json` (or the lockfile), so a new release never changes a
  pipeline by surprise ([upgrading](../upgrade.md)).

## Sharded jobs: one run

A matrix of jobs that each run part of the specs (`--spec`, Cypress Cloud's `--parallel`) makes
one run per job unless they share one: create it in a first job, pass its ULID to every job, and
close it in a last job that runs even after failed tests.
The complete workflow is in [sharding](sharding.md#github-actions).

## What CI detection fills in

With `GITHUB_ACTIONS=true`, the run gets these values unless an option or a `PROBARA_*` variable
sets them:

| Field     | From                                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| Run name  | `GITHUB_WORKFLOW #GITHUB_RUN_NUMBER`, such as `Cypress #42`                           |
| Branch    | `GITHUB_HEAD_REF` (the pull request's branch), else `GITHUB_REF_NAME`; none for a tag |
| Commit    | `GITHUB_SHA`                                                                          |
| Build URL | `GITHUB_SERVER_URL/GITHUB_REPOSITORY/actions/runs/GITHUB_RUN_ID`                      |

On `pull_request` events `GITHUB_SHA` is the merge commit GitHub made, not the branch's last
commit. To record the latter, add `PROBARA_COMMIT: ${{ github.event.pull_request.head.sha }}`.

## Fork pull requests

Workflows triggered by a pull request from a fork get empty secrets. Without a token the reporter
stays off and quiet, so fork builds run their tests and report nothing, with no extra setting. Do
not use `pull_request_target` to get the secret into a fork build: it runs the fork's code with
your secrets.

## See also

- [Sharding](sharding.md): one run for a sharded pipeline.
- [Results file](../results-file.md): keep what could not be sent.
- [Troubleshooting](../troubleshooting.md).
