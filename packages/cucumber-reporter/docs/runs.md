# Runs

A run groups the results of one test run in Probara. The formatter creates one, named after the CI
build (or `Automated run <date>` outside CI), and closes it when the run ends. A run can also be
created before the tests and reused by every shard, as the other reporters do.

- `run.name`, `run.description`, `run.environment`, `run.milestone`, `run.plan`, `run.configurations`
  and `run.tags` describe a new run. A `run.ulid` (`PROBARA_RUN_ULID`) reports into an existing one,
  and is not closed by default. So does a `run.id` (`PROBARA_RUN_ID`), the run Probara launched the
  workflow for ([GitHub Actions](ci/github-actions.md#a-run-launched-from-probara)).
- `closeRun` (`PROBARA_CLOSE_RUN`) closes the run at the end: `true` for a new run, `false` for a reused
  one unless you set it.
- In GitHub Actions the jobs of one workflow run share one run, unless they set `run.ulid` or
  `run.id`: the first job creates it, the jobs leave it open with `closeRun: false`, and a final job
  closes it ([parallel jobs](ci/github-actions.md#parallel-jobs-one-run-closed-by-the-final-job)).
- `projects` (`PROBARA_PROJECTS`) lets a result go to a case of another project: each result is sent
  to the run of the project of its case.

Create the run in the job that starts the tests, and pass its ULID to every shard, as the
[`probara run create`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md)
command does.
