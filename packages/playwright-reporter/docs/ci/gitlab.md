# GitLab CI

The reporter runs inside `npx playwright test`: give the test job the token as a CI/CD variable,
and every test is reported as it runs.

## 1. Add the variable

**Settings → CI/CD → Variables → Add variable**: key `PROBARA_API_TOKEN`, the token as the value,
with **Mask variable** on. **Protect variable** limits it to protected branches and tags: turn it
on only if you report from those alone. The token is an app token from the **Playwright** card in
**Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The test job

A complete `.gitlab-ci.yml`, in Playwright's image, with the reporter registered in
`playwright.config` as in the [quick start](../../README.md#quick-start):

```yaml
stages:
  - test

playwright:
  stage: test
  image: mcr.microsoft.com/playwright:v1.56.1-noble
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx playwright test
  artifacts:
    when: always
    paths:
      - test-results/
```

- Match the image's Playwright version to the one in your `package.json`.
- A job without the variable (a fork's pipeline, an unprotected branch with a protected variable)
  runs its tests and reports nothing.
- Failed tests fail the job, reporting problems do not
  ([reporting never breaks your test run](../../README.md#reporting-never-breaks-your-test-run)).

## Sharded jobs: one run with `merge-reports`

`parallel:` shards write blob reports, and one job merges them with the reporter into one run.
Register `blob` on CI and the reporter elsewhere, as in
[sharding](sharding.md#pattern-1-merge-the-blob-reports):

```yaml
stages:
  - test
  - report

playwright:
  stage: test
  image: mcr.microsoft.com/playwright:v1.56.1-noble
  parallel: 4
  script:
    - npm ci
    - npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL
  artifacts:
    when: always
    paths:
      - blob-report/

report-to-probara:
  stage: report
  image: mcr.microsoft.com/playwright:v1.56.1-noble
  needs:
    - job: playwright
      artifacts: true
  variables:
    PROBARA_PROJECT: SHOP
  rules:
    # After failed shards too, and only where the token is set.
    - if: $PROBARA_API_TOKEN
      when: always
  script:
    - npm ci
    - npx playwright merge-reports --reporter @probara/playwright-reporter ./blob-report
```

A `needs:` on a `parallel:` job downloads the artifacts of every instance into the same folder;
each shard's blob report has its own file name (`report-1.zip`...), so they sit side by side.

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
CI/CD variables: the reporter stays off there. If maintainers run fork pipelines in the parent
project, those pipelines do get the variable, so review the change before you run it.

## See also

- [Sharding](sharding.md).
- [Results file](../results-file.md).
- [Troubleshooting](../troubleshooting.md).
