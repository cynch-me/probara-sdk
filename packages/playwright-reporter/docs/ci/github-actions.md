# GitHub Actions

The reporter runs inside `npx playwright test`: give that step the token, and every test is
reported as it runs. No separate report step is needed.

## 1. Add the secret

In the repository (or organization): **Settings → Secrets and variables → Actions → New
repository secret**, named `PROBARA_API_TOKEN`, holding an app token from the **Playwright** card
in **Integrations** ([get a token](../configuration.md#get-a-token)). The project code is not a
secret: put it in `playwright.config` (`projectId`) or in the workflow (`PROBARA_PROJECT`).

## 2. Give the test step the token

A complete workflow, with the reporter registered in `playwright.config` as in the
[quick start](../../README.md#quick-start):

```yaml
name: Playwright

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
      - run: npx playwright install --with-deps
      - name: Run Playwright tests
        run: npx playwright test
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
```

- **Node.js**: the reporter needs Node.js 22.12 or later, like the rest of your Playwright run.
- **Failed tests fail the step, reporting problems do not**: Playwright's exit code stays the
  tests' own ([reporting never breaks your test run](../../README.md#reporting-never-breaks-your-test-run)).
- **Pin the version** in `package.json` (or the lockfile), so a new release never changes a
  pipeline by surprise ([upgrading](../upgrade.md)).

## Sharded jobs: one run with `merge-reports`

Shards write Playwright blob reports, and one job merges them with the reporter: the whole
pipeline becomes one run, attempts and attachments included. Register `blob` on CI and the reporter
elsewhere:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: process.env.CI ? 'blob' : [['list'], ['@probara/playwright-reporter']],
});
```

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
      - run: npx playwright install --with-deps
      - run: npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: blob-report-${{ matrix.shardIndex }}
          path: blob-report
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
          path: all-blob-reports
          pattern: blob-report-*
          merge-multiple: true
      - run: npx playwright merge-reports --reporter @probara/playwright-reporter ./all-blob-reports
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
```

To report while the shards run instead, create the run first and pass it to every shard: see
[sharding](sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it).

## What CI detection fills in

With `GITHUB_ACTIONS=true`, the run gets these values unless an option or a `PROBARA_*` variable
sets them:

| Field     | From                                                                                  |
| --------- | ------------------------------------------------------------------------------------- |
| Run name  | `GITHUB_WORKFLOW #GITHUB_RUN_NUMBER`, such as `Playwright #42`                        |
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

- [Sharding](sharding.md): every way to get one run for a sharded pipeline.
- [Results file](../results-file.md): keep what could not be sent.
- [Troubleshooting](../troubleshooting.md).
