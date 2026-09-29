# GitLab CI

Run the import in its own job, after the tests, from their artifacts. Its rule makes it run even
when the tests failed, and only where the token exists.

> Until `@probara/cli` is published, replace `npx @probara/cli` with a build of this repository
> ([how](../../README.md#use-it-before-it-is-published)).

## 1. Add the variable

**Settings → CI/CD → Variables → Add variable**: key `PROBARA_API_TOKEN`, the token as the value,
with **Mask variable** on. **Protect variable** limits it to protected branches and tags: turn it
on only if you report from those alone. Add `PROBARA_PROJECT` the same way, or in the file. The
token is an app token from the **JUnit XML** card in **Integrations**
([get a token](../configuration.md#get-a-token)).

## 2. Add the job

A complete `.gitlab-ci.yml` for a pytest project. The import runs in a Node image, so the test
image needs no Node:

```yaml
stages:
  - test
  - report

test:
  stage: test
  image: python:3.12
  script:
    - pip install -r requirements.txt
    - pytest --junitxml=reports/pytest.xml
  artifacts:
    when: always
    paths:
      - reports/
    reports:
      junit: reports/pytest.xml

report-to-probara:
  stage: report
  image: node:22
  needs:
    - job: test
      artifacts: true
  variables:
    PROBARA_PROJECT: SHOP
  rules:
    # Run after failed tests too, and only where the token is set.
    - if: $PROBARA_API_TOKEN
      when: always
  script:
    - npx @probara/cli import junit reports/pytest.xml
```

- `artifacts: when: always` keeps the report of a failed test job, so the next job can import it.
- Keep attachments with the report: add their folder to `artifacts: paths`.
- GitLab reads the same file for its own test report (`reports: junit`); the two do not interfere.

## Run it even when the tests fail

`when: always` in the rule runs the job whatever the earlier jobs did. The import exits 0 when
tests failed, so the pipeline's status still comes from the `test` job
([exit codes](../exit-codes.md)). To keep a Probara outage from failing the pipeline, add
`allow_failure: true` to the job.

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
CI/CD variables. The rule `if: $PROBARA_API_TOKEN` leaves the job out of those pipelines instead of
failing. If maintainers run fork pipelines in the parent project, those pipelines do get the
variable, so review the change before you run it.

## See also

- [Sharded runs](sharding.md): `parallel:` jobs into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
