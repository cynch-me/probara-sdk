# Sharding and CI

Each `cypress run` creates its own Probara run, so four machines that each run part of the specs
make four runs. To get **one** run for the whole pipeline, create the run first, report into it from
every machine, and close it at the end. Every job that reports needs `PROBARA_API_TOKEN`, an app
token from the **Cypress** card in **Integrations** ([get a token](../configuration.md#get-a-token)),
set up as in [your CI's guide](../../README.md#documentation).

| Pattern                                                                                                 | Choose it when                                                           |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Create the run, report from each machine, close it](#create-the-run-report-from-each-machine-close-it) | The usual way: each machine's results appear as soon as it finishes      |
| [Results files, imported by one job](#alternative-results-files-imported-by-one-job)                    | The machines cannot hold the token, or one job should do all the sending |

## How the specs get split

Cypress has no `--shard` flag: each machine runs its own `cypress run`, and something decides which
specs it runs. The reporter does not care what:

| Splitter                                                                                                          | What each machine runs                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--spec`                                                                                                          | The specs you list, such as `npx cypress run --spec 'cypress/e2e/cart/**'`                                                                       |
| [Cypress Cloud](https://docs.cypress.io/cloud/features/smart-orchestration/parallelization) `--record --parallel` | The specs Cypress Cloud hands it, one at a time                                                                                                  |
| A plugin such as [cypress-split](https://github.com/bahmutov/cypress-split)                                       | Its share of the specs; register it [with cypress-on-fix](../configuration.md#with-other-plugins): it registers `after:spec` and `after:run` too |

Cypress Cloud's run (`--ci-build-id`, `--group`) is a Cypress Cloud concept: the reporter neither
reads nor needs it. What makes the machines report into one Probara run is `PROBARA_RUN_ULID`, the
same on every machine.

## Create the run, report from each machine, close it

1. A first job runs `probara run create`, which creates an empty automated run and prints its ULID
   on stdout.
2. Every machine runs `npx cypress run` (with its share of the specs) with that ULID in
   `PROBARA_RUN_ULID`. A `cypress run` never closes a run it did not create, so they all report into
   the open run. Probara reconciles machines that report at the same moment: no case is added to the
   run twice.
3. A last job runs `probara run close`, after every machine, **even when tests failed**.

In a shell, the whole flow is:

```bash
PROBARA_RUN_ULID=$(npx @probara/cli run create)
export PROBARA_RUN_ULID
npx cypress run --spec 'cypress/e2e/cart/**'
npx cypress run --spec 'cypress/e2e/login/**'
npx @probara/cli run close
```

Assign the ULID on its own line: `export PROBARA_RUN_ULID=$(...)` would hide a failed creation.
`probara` is the [Probara CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md);
it takes the same token and project. Options of a new run go to `run create` (`--run-name`,
`--environment`, `--milestone`, `--plan`, `--tag`...), since the machines reuse the run and ignore
their own run options ([run options](../runs.md)).

Each machine sends its results when its own `cypress run` ends (`after:run`), so a run fills in
machine by machine, not test by test.

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
        spec: ['cypress/e2e/cart/**', 'cypress/e2e/login/**', 'cypress/e2e/search/**']
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx cypress run --spec '${{ matrix.spec }}'
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

With the token missing (a fork), `run create` prints nothing and exits 0, the machines report
nothing, and the close job is skipped. With Cypress Cloud, replace the matrix of specs with
`containers: [1, 2, 3]` and run `npx cypress run --record --parallel` in each: the
`PROBARA_RUN_ULID` part does not change.

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

cypress:
  stage: test
  image: cypress/browsers:latest
  parallel:
    matrix:
      - SPEC: ['cypress/e2e/cart/**', 'cypress/e2e/login/**', 'cypress/e2e/search/**']
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx cypress run --spec "$SPEC"

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
after failed tests.

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
npx cypress run --spec 'cypress/e2e/cart/**'
npx @probara/cli run close --run-ulid "$SHOP_RUN"
npx @probara/cli run close --project WEB --run-ulid "$WEB_RUN"
```

When the configured project's run is reused but a listed project has no run in `run.ulids`, each
machine creates its own run in that project, and a warning says so.

## Alternative: results files, imported by one job

Each machine runs with reporting off and writes every result to a
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
        shard: [cart, login, search]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx cypress run --spec 'cypress/e2e/${{ matrix.shard }}/**'
        env:
          PROBARA_ENABLED: 'false'
          PROBARA_PROJECT: SHOP
          PROBARA_RESULTS_FILE: probara-results-${{ matrix.shard }}.json
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: probara-results-${{ matrix.shard }}
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

- Give each machine its own file name (`probara-results-<shard>.json`), so the downloads never
  overwrite each other.
- `probara import results` sends every file into `PROBARA_RUN_ULID`, leaves that run open (it
  reused it), and deletes each file once sent. `run close` then closes it.
- Nothing reaches Probara until the last job: a machine that crashed leaves no results file, and its
  results are missing.
- Re-running the report job runs `run create` again: the files, downloaded again as they were, go
  into a second run with the same results. Close or delete the one you do not keep.

## If the close never ran

A run stays open until it is closed. Close it by hand, with the ULID from the log of the create
job:

```bash
npx @probara/cli run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

## Which approach loses less

| Something goes wrong                  | Shared run (create, machines, close)                                                           | Results files, one import                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A machine crashes before its run ends | Its results are lost: they are sent at `after:run`                                             | Its file is missing: none of its results are sent                |
| Probara is unreachable                | Each machine's [results file](../results-file.md) keeps what it could not send (if one is set) | The import exits 1 and keeps in each file what it could not send |
| The close job does not run            | The run stays open: [close it by hand](#if-the-close-never-ran)                                | Same                                                             |

## See also

- [`probara run create` and `probara run close`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-run-create).
- [Run options](../runs.md): options of a reused run are ignored.
- [Troubleshooting: the run stays open](../troubleshooting.md#the-run-stays-open).
