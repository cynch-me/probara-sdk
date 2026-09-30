# GitLab CI

The reporter runs inside `npx jest`: give the test job the token as a CI/CD variable, and every
test is reported as its file ends.

## 1. Add the variable

**Settings → CI/CD → Variables → Add variable**: key `PROBARA_API_TOKEN`, the token as the value,
with **Mask variable** on. **Protect variable** limits it to protected branches and tags: turn it
on only if you report from those alone. The token is an app token from the **Jest** card in
**Integrations** ([get a token](../configuration.md#get-a-token)).

## 2. The test job

A complete `.gitlab-ci.yml`, with the reporter registered in `jest.config.js` as in the
[quick start](../../README.md#quick-start):

```yaml
stages:
  - test

jest:
  stage: test
  image: node:22
  variables:
    PROBARA_PROJECT: SHOP
  script:
    - npm ci
    - npx jest --ci
```

- A job without the variable (a fork's pipeline, an unprotected branch with a protected variable)
  runs its tests and reports nothing.
- Failed tests fail the job, reporting problems do not
  ([reporting never breaks your test run](../../README.md#reporting-never-breaks-your-test-run)).
- To keep what could not be sent, set `PROBARA_RESULTS_FILE` and keep the file as an artifact
  ([results file](../results-file.md#in-ci)).

## Sharded jobs: one run

`parallel:` shards make one run each unless they share one: a `.pre` job creates the run and hands
its ULID to every shard in a dotenv artifact, and a `.post` job closes it, even after failed shards.
The complete `.gitlab-ci.yml` is in [sharding](sharding.md#gitlab-ci).

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
