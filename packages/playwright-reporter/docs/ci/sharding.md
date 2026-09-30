# Sharding and CI

Each `playwright test` creates its own run by default, so four shards make four runs. To get
**one** run for the whole pipeline, pick one of two patterns. Every job that reports needs
`PROBARA_API_TOKEN`, an app token from the **Playwright** card in **Integrations**
([get a token](../configuration.md#get-a-token)), set up as in
[your CI's guide](../../README.md#documentation).

| Pattern                                                                                                          | Choose it when                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [1. Merge the blob reports](#pattern-1-merge-the-blob-reports)                                                   | Simplest, and Playwright's own way. One job reports; no open run if a shard crashes. |
| [2. Create the run, report from each shard, close it](#pattern-2-create-the-run-report-from-each-shard-close-it) | Results should appear while the shards run.                                          |

Parallel workers of one `playwright test` need nothing: they all report through the one reporter
of the main process, into one run.

## Pattern 1: merge the blob reports

Each shard writes a Playwright [blob report](https://playwright.dev/docs/test-sharding#merging-reports-from-multiple-shards)
and keeps it as an artifact; a last job merges them with the reporter. The merged run holds every
attempt of every shard, with the same keys as one run of the whole suite, and the files the blob
reports carry (screenshots, traces, `testInfo.attach()` files).

1. Register `blob` on CI and the reporter elsewhere:

   ```ts
   // playwright.config.ts
   import { defineConfig } from '@playwright/test';

   export default defineConfig({
     reporter: process.env.CI ? 'blob' : [['list'], ['@probara/playwright-reporter']],
   });
   ```

2. Run each shard: `npx playwright test --shard=1/4` writes `blob-report/`. The shards need no
   token.
3. Collect every `blob-report/` into one folder, and merge it with the token in the environment:

   ```bash
   npx playwright merge-reports --reporter @probara/playwright-reporter ./all-blob-reports
   ```

To give the reporter options while merging, put them in a config for the merge
(`npx playwright merge-reports --config merge.config.ts ./all-blob-reports`):

```ts
// merge.config.ts
export default {
  testDir: './tests',
  reporter: [['@probara/playwright-reporter', { projectId: 'SHOP', run: { tags: ['sharded'] } }]],
};
```

Keep `testDir` the same as in `playwright.config`: the keys are relative to it. The complete
workflows are in the [GitHub Actions](github-actions.md#sharded-jobs-one-run-with-merge-reports),
[GitLab CI](gitlab.md#sharded-jobs-one-run-with-merge-reports) and
[Bitbucket](bitbucket.md) guides.

## Pattern 2: create the run, report from each shard, close it

1. A first job runs `probara run create`, which creates an empty automated run and prints its ULID
   on stdout.
2. Every shard runs with that ULID in `PROBARA_RUN_ULID`. A shard never closes a run it did not
   create, so they all report into the open run. Probara reconciles shards that report at the same
   moment: no case is added to the run twice.
3. A last job runs `probara run close`, after every shard, **even when shards failed**.

In a shell, the whole flow is:

```bash
PROBARA_RUN_ULID=$(npx @probara/cli run create)
export PROBARA_RUN_ULID
npx playwright test --shard=1/2
npx playwright test --shard=2/2
npx @probara/cli run close
```

Assign the ULID on its own line: `export PROBARA_RUN_ULID=$(...)` would hide a failed creation.
`probara` is the [Probara CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md);
it takes the same token and project. Options of a new run go to `run create`
(`--run-name`, `--environment`, `--milestone`, `--plan`, `--tag`...), since the shards reuse the
run.

### GitHub Actions

```yaml
jobs:
  probara-run:
    runs-on: ubuntu-latest
    outputs:
      ulid: ${{ steps.create.outputs.ulid }}
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - id: create
        run: |
          ulid=$(npx @probara/cli run create)
          echo "ulid=$ulid" >> "$GITHUB_OUTPUT"

  test:
    needs: probara-run
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
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          PROBARA_RUN_ULID: ${{ needs.probara-run.outputs.ulid }}

  close-probara-run:
    needs: [probara-run, test]
    if: always() && needs.probara-run.outputs.ulid != ''
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npx @probara/cli run close
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          PROBARA_RUN_ULID: ${{ needs.probara-run.outputs.ulid }}
```

With the token missing (a fork), `run create` prints nothing and exits 0, the shards report
nothing, and the close job is skipped.

### GitLab CI

A dotenv artifact hands the ULID to every later job:

```yaml
stages:
  - test

create-probara-run:
  stage: .pre
  image: node:22
  variables:
    PROBARA_PROJECT: SHOP
  rules:
    - if: $PROBARA_API_TOKEN
  script:
    - PROBARA_RUN_ULID=$(npx @probara/cli run create)
    - echo "PROBARA_RUN_ULID=$PROBARA_RUN_ULID" > probara.env
  artifacts:
    reports:
      dotenv: probara.env

playwright:
  stage: test
  image: mcr.microsoft.com/playwright:v1.56.1-noble
  parallel: 4
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL

close-probara-run:
  stage: .post
  image: node:22
  variables:
    PROBARA_PROJECT: SHOP
  rules:
    - if: $PROBARA_API_TOKEN
      when: always
  script:
    - npx @probara/cli run close
```

`.pre` and `.post` are GitLab's built-in first and last stages; `when: always` closes the run even
after failed shards.

### Several Probara projects

With [`projects`](../multi-project.md), create one run per project and pass them all in
`PROBARA_RUN_ULIDS` (`SHOP=<ulid>,WEB=<ulid>`); close each one at the end
([several projects](../multi-project.md#sharded-jobs)).

## If the close never ran

A run stays open until it is closed. Close it by hand, with the ULID from the log of the create
job:

```bash
npx @probara/cli run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

## Which pattern loses less

| Something goes wrong               | Pattern 1 (merge)                                | Pattern 2 (shared run)                                   |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| A shard crashes before it finishes | Its blob report is missing; the rest is reported | Its results so far are in the run                        |
| Probara is unreachable             | The merge job fails to report; re-run it         | Each shard's [results file](../results-file.md) keeps it |
| The close job does not run         | Nothing to close                                 | The run stays open: close it by hand                     |

## See also

- [`probara run create` and `probara run close`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-run-create).
- [Run options](../runs.md): options of a reused run are ignored.
- [Troubleshooting: the run was left open](../troubleshooting.md#the-run-was-left-open).
