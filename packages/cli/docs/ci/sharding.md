# Sharded runs

When tests are split across parallel jobs (shards, a matrix, `parallel:`), each job imports on its
own by default, and each import creates its own run. To get **one** run for the whole pipeline,
pick one of two patterns. Every job that reports needs `PROBARA_API_TOKEN`, an app token from
the **JUnit XML** card in **Integrations** ([get a token](../configuration.md#get-a-token)), set
up as in [your CI's guide](../../README.md#documentation).

| Pattern                                                                                                          | Choose it when                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [1. Collect every shard, import once](#pattern-1-collect-every-shard-and-import-once)                            | Simplest. One import, fewest requests, and no open run if a shard crashes.          |
| [2. Create the run, report from each shard, close it](#pattern-2-create-the-run-report-from-each-shard-close-it) | Results should appear while shards run, or passing reports between jobs is awkward. |

## Pattern 1: collect every shard and import once

Each shard keeps its report as an artifact; a final job downloads them all and imports them into
one run. `import junit` takes several files and globs, so nothing needs merging.

### GitHub Actions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx jest --ci --shard=${{ matrix.shard }}/4 --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: reports
          JEST_JUNIT_ADD_FILE_ATTRIBUTE: 'true'
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: junit-${{ matrix.shard }}
          path: reports/

  report:
    needs: test
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - uses: actions/download-artifact@v4
        with:
          pattern: junit-*
          path: shards
      - run: npx @probara/cli import junit "shards/**/*.xml"
        env:
          PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
          PROBARA_PROJECT: SHOP
          PROBARA_ENABLED: ${{ secrets.PROBARA_API_TOKEN != '' }}
```

`download-artifact` puts each artifact in its own folder (`shards/junit-1/junit.xml`...), which
the quoted glob finds. Keep attachments inside the uploaded folder, next to the report, so their
relative paths still resolve.

### GitLab CI

```yaml
stages:
  - test
  - report

test:
  stage: test
  image: node:22
  parallel: 4
  script:
    - npm ci
    - export PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/playwright-$CI_NODE_INDEX.xml
    - npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL --reporter=junit
  artifacts:
    when: always
    paths:
      - reports/

report-to-probara:
  stage: report
  image: node:22
  needs:
    - job: test
      artifacts: true
  variables:
    PROBARA_PROJECT: SHOP
  rules:
    - if: $PROBARA_API_TOKEN
      when: always
  script:
    - npx @probara/cli import junit "reports/**/*.xml"
```

A `needs:` on a `parallel:` job waits for, and downloads, every one of its instances.

## Pattern 2: create the run, report from each shard, close it

1. A first job runs `probara run create`, which creates an empty automated run (no cases: each
   import adds the ones it reports) and prints its ULID on stdout. A manual run created in the
   Probara app still needs its cases.
2. Every shard imports with that ULID in `PROBARA_RUN_ULID`. A shard never closes a run it did not
   create, so they all write into the open run. Probara reconciles shards that report at the same
   moment: no case is added to the run twice.
3. A last job runs `probara run close`, after every shard, **even when shards failed**.

In a shell, the whole flow is:

```bash
PROBARA_RUN_ULID=$(probara run create)
export PROBARA_RUN_ULID
probara import junit shards/shard-1/junit.xml
probara import junit shards/shard-2/junit.xml
probara run close
```

Assign the ULID on its own line: `export PROBARA_RUN_ULID=$(...)` would hide a failed creation.

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
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test --shard=${{ matrix.shard }}/4
      - if: always()
        run: npx @probara/cli import junit reports/playwright.xml
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

test:
  stage: test
  image: node:22
  parallel: 4
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL
  after_script:
    - npx @probara/cli import junit reports/playwright.xml

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

- `.pre` and `.post` are GitLab's built-in first and last stages; `when: always` closes the run
  even after failed shards. Without the token (a fork's pipeline) both jobs are left out, and the
  shards' imports fail in `after_script` without failing the shards.
- `after_script` runs after a failed `script`, but its exit code never fails the job. Put the
  import at the end of `script` instead if a failed import must fail the shard.

## If the close never ran

A run stays open until it is closed. Close it by hand, with the ULID from the log of the create
job:

```bash
probara run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

## See also

- [`probara run create` and `probara run close`](../commands.md#probara-run-create).
- [GitHub Actions](github-actions.md), [GitLab CI](gitlab.md).
- [Troubleshooting: the run was left open](../troubleshooting.md#the-run-was-left-open).
