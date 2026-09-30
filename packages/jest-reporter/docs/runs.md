# Run options

Each `jest` command reports into one Probara run: a new automated run by default, closed at the
end, or an existing one. These options describe the run the reporter creates.

<!-- project: run-options -->

```js
reporters: [
  'default',
  [
    '@probara/jest-reporter',
    {
      run: {
        name: 'Nightly regression',
        description: 'Every night on main, against staging.',
        environment: 'staging',
        milestone: 'Sprint 12',
        plan: 'PLAN-2',
        configurations: [
          { group: 'Node', name: '22' },
          { group: 'OS', name: 'Linux' },
        ],
        tags: ['nightly', 'unit'],
      },
    },
  ],
],
```

| Option               | Variable                  | What it sets                                                                                |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `run.name`           | `PROBARA_RUN_NAME`        | The name. Default: the CI build name (`CI #42`), else `Automated run <date> <time> UTC`     |
| `run.description`    | `PROBARA_RUN_DESCRIPTION` | The description, up to 2000 characters (longer is cut, with a warning)                      |
| `run.environment`    | `PROBARA_ENVIRONMENT`     | The environment, by name: created in the project when none has that name                    |
| `run.milestone`      | `PROBARA_MILESTONE`       | The milestone, by display id (`M-3`) or exact name                                          |
| `run.plan`           | `PROBARA_PLAN`            | The test plan, by display id (`PLAN-2`) or exact name: the run starts with the plan's cases |
| `run.configurations` | `PROBARA_CONFIGURATIONS`  | Configuration values by group and name (`Node=22,OS=Linux`), each group once                |
| `run.tags`           | `PROBARA_RUN_TAGS`        | Tags (`nightly,unit`), up to 50                                                             |

The same run from the environment of a CI step, with the project in the config:

```bash
PROBARA_RUN_NAME="Nightly regression" PROBARA_ENVIRONMENT=staging PROBARA_RUN_TAGS=nightly,unit npx jest
```

## Names or ULIDs

The environment, milestone and configurations also take ULIDs: `run.environmentId`,
`run.milestoneId` and `run.configurationUlids` (`PROBARA_ENVIRONMENT_ID`, `PROBARA_MILESTONE_ID`,
`PROBARA_CONFIGURATION_ULIDS`). Set one form of each, never both: both is a configuration problem
that turns reporting off. Names are the form to use with an app token, which cannot look ULIDs up.

- An unknown environment **name** creates the environment.
- An unknown milestone, plan or configuration makes Probara refuse the first report (422, naming
  the field): nothing is recorded, and the log says why. Check the names in Probara.

## Run source

A run records where it came from: the branch, the commit and the CI build URL, read from the
variables of GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Jenkins, Bitbucket Pipelines and
Buildkite ([what each CI fills in](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#ci-detection)).
Override a field with `source` or its variable, or send none:

<!-- project: source -->

```js
reporters: ['default', ['@probara/jest-reporter', { source: { branch: 'release/2.4' } }]],
```

| Option            | Variable            | Default              |
| ----------------- | ------------------- | -------------------- |
| `source.branch`   | `PROBARA_BRANCH`    | detected from the CI |
| `source.commit`   | `PROBARA_COMMIT`    | detected from the CI |
| `source.buildUrl` | `PROBARA_BUILD_URL` | detected from the CI |
| `source: false`   | —                   | sends no source      |

The CI build name also names the run when `run.name` is not set.

## An existing run

`run.ulid` (`PROBARA_RUN_ULID`) reports into a run that exists, such as one `probara run create`
made for the shards of a pipeline ([sharding](ci/sharding.md)) or one a person created in Probara
([run selection](run-selection.md)). The reporter adds its results to that run and leaves it open:

<!-- output: default, scenario: existing-run -->

```text
$ PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx jest
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

The options of a new run are then ignored, with one warning: the run keeps its own name,
environment, milestone and configurations.

<!-- project: reused-with-options -->

```js
reporters: ['default', ['@probara/jest-reporter', { run: { name: 'Nightly regression' } }]],
```

<!-- output: reused-with-options, scenario: existing-run -->

```text
$ PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3 npx jest
[probara] Ignored name: a reused run (run.ulid) keeps its own
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked)
[probara] Recorded 3 results (2 new cases, 0 unmatched) in R-1 (open): https://app.probara.net/projects/SHOP/runs/R-1
```

To get a run's ULID in Probara, open the run and choose **Copy run ULID** in **Run actions** (the
menu in the run's header).

## Closing

| The run                                 | At the end of `jest`                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| Created by the reporter                 | Closed, once every result and file was sent                |
| Reused (`run.ulid`)                     | Left open: whoever created it closes it                    |
| Created in a `--watch` session          | Left open, for the next re-run ([watch mode](watch.md))    |
| Any, when a report failed after retries | Left open: the log names it, and the error says what to do |

`closeRun` (`PROBARA_CLOSE_RUN`) decides for every run of a command that is not a watch session:
`true` closes a reused run too, `false` leaves a created one open. `closeRuns` decides per project
(`{ SHOP: true, WEB: false }`) when `closeRun` is not set. When a report fails, what was not sent
can go to a [results file](results-file.md), which `probara import results` sends later into the
same run, and closes it like the reporter would have.

Close a run by hand with the [Probara CLI](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/README.md):

```bash
npx @probara/cli run close --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

## Several projects

With [`projects`](projects.md#several-probara-projects), each Probara project gets its own run.
The name, description, environment (by name) and tags go with every new run. The milestone, plan
and configurations are planning entities of one project, where an unknown name would refuse the
whole report, so they go with the configured project's run only, like the ULIDs; one warning names
them. To set them in another project, create its run first and pass it in `run.ulids`.

## See also

- [Configuration](configuration.md): every option.
- [Sharding and CI](ci/sharding.md): one run for every shard.
- [Watch mode](watch.md): one run per watch session.
