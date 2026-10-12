# GitLab CI

The reporter runs inside `npx vitest run`: give the test job the token as a masked CI/CD variable,
and the run is reported when Vitest ends. The token is never printed: a problem names the variable,
never its value.

## 1. Add the variable

**Settings → CI/CD → Variables → Add variable**: key `PROBARA_API_TOKEN`, the token as the value,
with **Mask variable** on. **Protect variable** limits it to protected branches and tags: turn it
on only if you report from those alone. The token is an app token from the **Vitest** card in
**Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The test job

A complete `.gitlab-ci.yml`, with the reporter registered in `vitest.config.mts` as in the
[quick start](../../README.md#quick-start):

```yaml
stages:
  - test

vitest:
  stage: test
  image: node:22
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx vitest run
```

- A job without the variable (a fork's pipeline, an unprotected branch with a protected variable)
  runs its tests and sends nothing; the reporter logs that the token is not set.
- Failed tests fail the job, reporting problems do not
  ([what the reporter never does](../debugging.md#what-the-reporter-never-does-to-the-run)).
- To keep what could not be sent, set `PROBARA_RESULTS_FILE` and keep the file as an artifact
  ([results file](../results-file.md#in-ci)).
- Every other setting is an option or a `PROBARA_*` variable of the job
  ([configuration](../configuration.md#options)).

## Sharded jobs: one run from the blobs

`parallel:` shards write Vitest blob reports with the reporter beside `blob`, and one job merges
them into one run ([sharding](sharding.md#pattern-1-merge-the-blob-reports)). Only the merging job
needs the token:

```yaml
stages:
  - test
  - report

vitest:
  stage: test
  image: node:22
  parallel: 4
  script:
    - npm ci
    - npx vitest run --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL --reporter=blob --reporter=@probara/vitest-reporter
  artifacts:
    when: always
    paths:
      - .vitest/

report-to-probara:
  stage: report
  image: node:22
  needs:
    - job: vitest
      artifacts: true
  variables:
    PROBARA_PROJECT: SHOP
  rules:
    # After failed shards too, and only where the token is set.
    - if: $PROBARA_API_TOKEN
      when: always
  script:
    - npm ci
    - npx vitest --merge-reports
```

- A `needs:` on a `parallel:` job downloads the artifacts of every instance into the same folder;
  each shard's blob has its own file name (`blob-1-4.json`...), so they sit side by side.
- `.vitest/` holds Vitest 5's blobs and `attachmentsDir`. On Vitest 3 and 4, keep
  `.vitest-reports/` and `.vitest-attachments/` instead.
- The merging job must check out at the shards' `CI_PROJECT_DIR`, or every key changes
  ([merge at the same path](sharding.md#merge-at-the-same-path)).

To have each shard report as it ends instead, create the run in a `.pre` job: see
[sharding](sharding.md#gitlab-ci).

## What CI detection fills in

With `GITLAB_CI=true`:

| Field     | From                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| Run name  | `CI_PROJECT_NAME #CI_PIPELINE_IID`, such as `shop #42`                                                                |
| Branch    | `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` in a merge request pipeline, else `CI_COMMIT_REF_NAME`; none for a tag pipeline |
| Commit    | `CI_COMMIT_SHA`                                                                                                       |
| Build URL | `CI_PIPELINE_URL`                                                                                                     |

## Fork merge requests

A merge request from a fork runs its pipeline in the fork's project, which does not have your
CI/CD variables: the reporter sends nothing there, and the rule `if: $PROBARA_API_TOKEN` leaves the
merging job out. If maintainers run fork pipelines in the parent project, those pipelines do get
the variable, so review the change before you run it.

## See also

- [Sharding](sharding.md).
- [Results file](../results-file.md).
- [Troubleshooting](../troubleshooting.md).
