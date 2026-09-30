# Sharding and CI

Each `jest` creates its own run by default, so four shards (`--shard=1/4` ... `--shard=4/4`) make
four runs. To get **one** run for the whole pipeline, create the run first, report into it from
every shard, and close it at the end. Every job that reports needs `PROBARA_API_TOKEN`, an app
token from the **Jest** card in **Integrations** ([get a token](../configuration.md#get-a-token)),
set up as in [your CI's guide](../../README.md#documentation).

| Pattern                                                                                             | Choose it when                                                         |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Create the run, report from each shard, close it](#create-the-run-report-from-each-shard-close-it) | The usual way: results appear while the shards run                     |
| [Results files, imported by one job](#alternative-results-files-imported-by-one-job)                | The shards cannot hold the token, or one job should do all the sending |

Parallel workers of one `jest` (`--maxWorkers`) need nothing: they all report through the one
reporter of Jest's main process, into one run.

## Create the run, report from each shard, close it

1. A first job runs `probara run create`, which creates an empty automated run and prints its ULID
   on stdout.
2. Every shard runs `npx jest --shard=<i>/<n>` with that ULID in `PROBARA_RUN_ULID`. A shard never
   closes a run it did not create, so they all report into the open run. Probara reconciles shards
   that report at the same moment: no case is added to the run twice.
3. A last job runs `probara run close`, after every shard, **even when shards failed**.

In a shell, the whole flow is:

```bash
PROBARA_RUN_ULID=$(npx @probara/cli run create)
export PROBARA_RUN_ULID
npx jest --shard=1/2
npx jest --shard=2/2
npx @probara/cli run close
```

Assign the ULID on its own line: `export PROBARA_RUN_ULID=$(...)` would hide a failed creation.
`probara` is the [Probara CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md);
it takes the same token and project. Options of a new run go to `run create` (`--run-name`,
`--environment`, `--milestone`, `--plan`, `--tag`...), since the shards reuse the run and ignore
their own run options ([run options](../runs.md)).

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
      - run: npx jest --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
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

jest:
  stage: test
  image: node:22
  parallel: 4
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx jest --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL

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

### Other CI

[Jenkins](jenkins.md), [CircleCI](circleci.md), [Azure Pipelines](azure-pipelines.md),
[Bitbucket](bitbucket.md) and [Buildkite](buildkite.md) follow the same three steps.

### Several Probara projects

With [`projects`](../projects.md#several-probara-projects), create one run per project and pass
them all in `PROBARA_RUN_ULIDS` (`SHOP=<ulid>,WEB=<ulid>`); close each one at the end:

```bash
SHOP_RUN=$(npx @probara/cli run create)
WEB_RUN=$(npx @probara/cli run create --project WEB)
export PROBARA_PROJECTS=WEB PROBARA_RUN_ULIDS="SHOP=$SHOP_RUN,WEB=$WEB_RUN"
npx jest --shard=1/2
npx @probara/cli run close --run-ulid "$SHOP_RUN"
npx @probara/cli run close --project WEB --run-ulid "$WEB_RUN"
```

When the configured project's run is reused but a listed project has no run in `run.ulids`, each
shard creates its own run in that project, and a warning says so.

## Alternative: results files, imported by one job

Each shard runs with reporting off and writes every result to a
[results file](../results-file.md), kept as an artifact with its `<name>-attachments/` folder. One
last job, which holds the token, downloads them all and sends them. The files of the attachments
are referenced relative to each results file, so the files and their folders can be downloaded
anywhere.

A results file written with reporting off names no run: imported on its own, each file creates a
run of its own. To get one run, create it first, import every file into it, and close it:

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
      - run: npx jest --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
        env:
          PROBARA_ENABLED: 'false'
          PROBARA_PROJECT: SHOP
          PROBARA_RESULTS_FILE: probara-results-${{ matrix.shardIndex }}.json
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: probara-results-${{ matrix.shardIndex }}
          path: probara-results-*
          retention-days: 1

  report:
    needs: test
    # Forks get no token: there is nothing to send with.
    if: ${{ !cancelled() && github.event.pull_request.head.repo.fork != true }}
    runs-on: ubuntu-latest
    env:
      PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
      PROBARA_PROJECT: SHOP
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - uses: actions/download-artifact@v4
        with:
          pattern: probara-results-*
          merge-multiple: true
      - run: |
          PROBARA_RUN_ULID=$(npx @probara/cli run create)
          export PROBARA_RUN_ULID
          npx @probara/cli import results 'probara-results*.json'
          npx @probara/cli run close
```

- Give each shard its own file name (`probara-results-<shard>.json`), so the downloads never
  overwrite each other.
- `probara import results` sends every file into `PROBARA_RUN_ULID`, leaves that run open (it
  reused it), and deletes each file once sent. `run close` then closes it.
- Nothing reaches Probara until the last job: a crashed shard leaves no results file, and its
  results are missing.
- Re-running the report job runs `run create` again: the shards' files, downloaded again as they
  were, go into a second run with the same results. Close or delete the one you do not keep.

## If the close never ran

A run stays open until it is closed. Close it by hand, with the ULID from the log of the create
job:

```bash
npx @probara/cli run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

## Which approach loses less

| Something goes wrong               | Shared run (create, shards, close)                                                                 | Results files, one import                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A shard crashes before it finishes | Its results so far are in the run                                                                  | Its file is missing: none of its results are sent                |
| Probara is unreachable             | Each shard's [results file](../results-file.md#in-ci) keeps what it could not send (if one is set) | The import exits 1 and keeps in each file what it could not send |
| The close job does not run         | The run stays open: [close it by hand](#if-the-close-never-ran)                                    | Same                                                             |

## See also

- [`probara run create` and `probara run close`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-run-create).
- [Run options](../runs.md): options of a reused run are ignored.
- [Troubleshooting: the run was left open](../troubleshooting.md#the-run-was-left-open).
