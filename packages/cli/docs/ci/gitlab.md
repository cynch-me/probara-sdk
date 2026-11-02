# GitLab CI

Run the import in its own job, after the tests, from their artifacts. Its rule makes it run even
when the tests failed, and only where the token exists.

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

## Gherkin: sync and Cucumber results

cucumber-js users can report each scenario, with its attachments, at the end of the run, instead of the JSON report and the import below: add `--format @probara/cucumber-reporter` to the test command and drop the import step ([the reporter's CI guide](https://github.com/cynch-me/probara-sdk/blob/main/packages/cucumber-reporter/docs/ci/gitlab.md)).

For `.feature` files kept in Git ([Gherkin](../gherkin.md)): sync them in a job before the tests,
on the default branch only, and import the Cucumber JSON report after the tests on every pipeline. Use an app token
from the **Cucumber** card in **Integrations**, so what the job sends shows **Cucumber**.

```yaml
stages:
  - sync
  - test
  - report

sync-to-probara:
  stage: sync
  image: node:22
  variables:
    PROBARA_PROJECT: SHOP
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $PROBARA_API_TOKEN
  script:
    - npx @probara/cli sync gherkin "features/**/*.feature"

test:
  stage: test
  image: node:22
  script:
    - npm ci
    - npx cucumber-js --format json:results/cucumber.json
  artifacts:
    when: always
    paths:
      - results/

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
    - npx @probara/cli import cucumber results/cucumber.json
```

- A merge request's scenarios are not merged yet, so they change no case; its results are still
  reported.
- Each job clones the repository, so the report job has the feature files `import cucumber` reads
  to key each result.
- The sync links each case to its file and line on GitLab by itself.

## See also

- [Sharded runs](sharding.md): `parallel:` jobs into one run.
- [Configuration](../configuration.md).
- [Troubleshooting](../troubleshooting.md).
