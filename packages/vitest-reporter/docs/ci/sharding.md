# Sharding and CI

Each `vitest run --shard` makes its own run unless the shards are tied together. Two patterns give
**one** run for the whole pipeline. The jobs that report need `PROBARA_API_TOKEN`, an app token from
the **Vitest** card in **Integrations** ([get a token](../configuration.md#get-a-token)), set up as
in [your CI's guide](#see-also).

| Pattern                                                                                                          | Choose it when                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [1. Merge the blob reports](#pattern-1-merge-the-blob-reports)                                                   | The usual way, and Vitest's own: one job reports every shard, and the shards need no token                                         |
| [2. Create the run, report from each shard, close it](#pattern-2-create-the-run-report-from-each-shard-close-it) | Each shard's results should reach Probara as soon as it ends, `runCasesOnly` should apply, or no job can merge at the shards' path |

The workers of one `vitest run` need nothing: they all report through the one reporter of Vitest's
main process, into one run.

## Pattern 1: merge the blob reports

Each shard writes a Vitest blob report, with the reporter beside the `blob` reporter, and one job
merges the blobs: `vitest --merge-reports` reports every attempt of every shard, with its steps and
files, into one run, and closes it.

1. Each shard runs with both reporters on its command line. `--reporter` replaces the reporters of
   the config, so name this one beside `blob`:
   `npx vitest run --shard=1/4 --reporter=blob --reporter=@probara/vitest-reporter`. The shard
   writes its blob, keeps the files its tests attached, sends nothing, and says so. It needs no
   token, and none of the reporter's options: the merge reports with those of the config.
2. Copy the blobs and the attachments of every shard into the job that merges, at the same path as
   on the shards ([below](#carry-the-blobs-and-the-attachments)).
3. That job runs `npx vitest --merge-reports` with the token: the reporter of the config sends every
   shard's results into one run.

In one shell, the whole flow is:

<!-- output: default -->

```text
$ npx vitest run --shard=1/2 --reporter=blob --reporter=@probara/vitest-reporter
[probara] Sharded run with the blob reporter: the results are reported by vitest --merge-reports
$ npx vitest run --shard=2/2 --reporter=blob --reporter=@probara/vitest-reporter
[probara] Sharded run with the blob reporter: the results are reported by vitest --merge-reports
$ npx vitest --merge-reports
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

The complete workflows are in the
[GitHub Actions](github-actions.md#sharded-jobs-one-run-from-the-blobs) and
[GitLab CI](gitlab.md#sharded-jobs-one-run-from-the-blobs) guides.

### The reporter goes beside `blob`

| The shards run with                                   | What the merge sends                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--reporter=blob --reporter=@probara/vitest-reporter` | Every attempt, the `probara.*` calls and their files                                                                                                                            |
| `--reporter=blob` alone                               | Only the final attempt of a retried test (one warning says how many), and no `probara.*` call: the reporter never ran in the shards ([retries](../retries.md#when-retries-run)) |

Keep `blob` out of the config `vitest --merge-reports` reads: Vitest refuses to merge with it
(``Cannot merge reports when `--reporter=blob` is used``).

### Carry the blobs and the attachments

| What                                            | Vitest 3 and 4         | Vitest 5               |
| ----------------------------------------------- | ---------------------- | ---------------------- |
| The blobs, which `vitest --merge-reports` reads | `.vitest-reports/`     | `.vitest/blob/`        |
| `attachmentsDir`: the files the tests attached  | `.vitest-attachments/` | `.vitest/attachments/` |

Keep both folders of every shard as artifacts, and download them all into the same folders of the
merging job: each blob has a name of its own (`blob-1-4.json`), and so has each copy of an attached
file. A file the merge cannot find is skipped, with the warning
`Skipped an attachment: its file is missing or unreadable`, and its result is sent all the same
([where the copies are kept](../attachments.md#where-the-copies-are-kept)).

### Merge at the same path

A blob names each test file, and each attached file, by its full path on the shard, and an
automation key starts with the test file's path from the root of the merging run. Merged at another
path, every key changes, and every test gets a new case. Run the merge in a checkout at the same
path as the shards. The logs show it: the root the merge's `RUN` line names must be the folder that
holds the `.vitest` folder (`.vitest-reports` on Vitest 3 and 4) of each shard's
`blob report written to` line.

### The same Vitest everywhere

`vitest --merge-reports` reads only the blobs of its own Vitest version, and fails on any other.
Install from the lockfile in every job (`npm ci`), and upgrade the shards and the merging job
together ([upgrading](../upgrade.md#any-upgrade-of-a-sharded-pipeline)).

### Run selection

`runCasesOnly` does not apply to shards that write a blob: each shard warns
(`runCasesOnly does not apply to a sharded run with the blob reporter: every test runs, and vitest --merge-reports reports them all`),
runs every test, and the merge reports them all. To run only the tests of a Probara run on shards,
use pattern 2 ([run selection](../run-selection.md#setups)).

## Pattern 2: create the run, report from each shard, close it

1. A first job runs `probara run create`, which creates an empty automated run and prints its ULID
   on stdout.
2. Every shard runs `npx vitest run --shard=<i>/<n>` with that ULID in `PROBARA_RUN_ULID`, and sends
   its results when it ends. A shard never closes a run it did not create, so they all report into
   the open run. Probara reconciles shards that report at the same moment: no case is added to the
   run twice.
3. A last job runs `probara run close`, after every shard, **even when shards failed**.

In a shell, the whole flow is:

```bash
PROBARA_RUN_ULID=$(npx @probara/cli run create)
export PROBARA_RUN_ULID
npx vitest run --shard=1/2
npx vitest run --shard=2/2
npx @probara/cli run close
```

Assign the ULID on its own line: `export PROBARA_RUN_ULID=$(...)` would hide a failed creation.
`probara` is the [Probara CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md);
it takes the same token and project. Options of a new run go to `run create` (`--run-name`,
`--environment`, `--milestone`, `--plan`, `--tag`...): the shards reuse the run, and ignore their own
run options with one warning ([an existing run](../runs.md#an-existing-run)). With `runCasesOnly`,
each shard reads the cases of the run, and runs only those of its tests that belong to the run
([run selection](../run-selection.md#setups)).

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
      # Fork pull requests get no secrets: report nothing there.
      PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
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
      - run: npx vitest run --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
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

Without the token (a fork), `PROBARA_ENABLED` is `false`: `run create` prints nothing and exits 0,
the shards report nothing, and the close job is skipped.

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

vitest:
  stage: test
  image: node:22
  parallel: 4
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx vitest run --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL

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
after failed shards. A pipeline without the variable (a fork's) has neither job, and its shards
report nothing.

### Other CI

[CircleCI](circleci.md), [Jenkins](jenkins.md), [Azure Pipelines](azure-pipelines.md),
[Bitbucket](bitbucket.md) and [Buildkite](buildkite.md) show the same three steps in their guides.
Pattern 1 works on them too when the merging job gets every shard's folders at the shards' path,
and runs after failed shards: Bitbucket skips the steps after a failed one.

### Several Probara projects

With [`projects`](../projects.md#several-probara-projects), pattern 1 needs nothing more: the merge
reports every project's results once. With pattern 2, create one run per project and pass them all
in `PROBARA_RUN_ULIDS`, then close each one ([sharded jobs](../projects.md#sharded-jobs)).

## If the close never ran

A run stays open until it is closed. Close it by hand, with the ULID from the log of the create
job:

```bash
npx @probara/cli run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

## Which pattern loses less

| Something goes wrong                 | Pattern 1 (merge)                                                                                | Pattern 2 (shared run)                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| A shard is killed before Vitest ends | Its blob is missing: the other shards are reported                                               | It sends nothing: the other shards are reported                                             |
| Probara is unreachable               | The merging job's [results file](../results-file.md#in-ci) keeps what it could not send (if set) | Each shard's [results file](../results-file.md#in-ci) keeps what it could not send (if set) |
| The close job does not run           | Nothing to close: the merge closes its own run                                                   | The run stays open: [close it by hand](#if-the-close-never-ran)                             |

In both, the exit code of every job stays the tests' own: a reporting problem never fails a shard
or the merge.

## See also

- The CI guides: [GitHub Actions](github-actions.md), [GitLab CI](gitlab.md),
  [CircleCI](circleci.md), [Azure Pipelines](azure-pipelines.md), [Jenkins](jenkins.md),
  [Bitbucket Pipelines](bitbucket.md) and [Buildkite](buildkite.md).
- [`probara run create` and `probara run close`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-run-create).
- [Run options](../runs.md): options of a reused run are ignored.
- [Troubleshooting: a shard sends nothing](../troubleshooting.md#a-shard-sends-nothing).
