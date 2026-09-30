# Run options

Each `playwright test` reports into one Probara run: a new automated run by default, closed at the
end, or an existing one. These options describe the run the reporter creates.

<!-- project: run-options -->

```ts
reporter: [
  [
    '@probara/playwright-reporter',
    {
      run: {
        name: 'Nightly regression',
        description: 'Every night on main, against staging.',
        environment: 'staging',
        milestone: 'Sprint 12',
        plan: 'PLAN-2',
        configurations: [
          { group: 'Browser', name: 'Chromium' },
          { group: 'OS', name: 'Linux' },
        ],
        tags: ['nightly', 'e2e'],
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
| `run.configurations` | `PROBARA_CONFIGURATIONS`  | Configuration values by group and name (`Browser=Chromium,OS=Linux`), each group once       |
| `run.tags`           | `PROBARA_RUN_TAGS`        | Tags (`nightly,e2e`), up to 50                                                              |

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

```ts
reporter: [['@probara/playwright-reporter', { source: { branch: 'release/2.4' } }]],
```

| Option            | Variable            | Default              |
| ----------------- | ------------------- | -------------------- |
| `source.branch`   | `PROBARA_BRANCH`    | detected from the CI |
| `source.commit`   | `PROBARA_COMMIT`    | detected from the CI |
| `source.buildUrl` | `PROBARA_BUILD_URL` | detected from the CI |
| `source: false`   | —                   | sends no source      |

The CI build name also names the run when `run.name` is not set.

## An existing run

`run.ulid` (`PROBARA_RUN_ULID`) reports into a run that exists, such as one
`probara run create` made for the shards of a pipeline ([sharding](ci/sharding.md)). The options of
a new run are then ignored, with one warning: the run keeps its own name, environment, milestone
and configurations. A reused run stays open unless `closeRun` (`PROBARA_CLOSE_RUN`) is `true`.

## Closing

A run the reporter creates is closed at the end, once every result and file was sent; a reused one
stays open. `closeRun` decides for every run. When a report fails, the run is left open: the log
names it, and what was not sent can go to a [results file](results-file.md).

## Several projects

With [`projects`](multi-project.md), each project gets its own run. The name, description,
environment (by name) and tags go with every new run. The milestone, plan and configurations are
planning entities of one project, where an unknown name would refuse the whole report, so they go
with the configured project's run only, like the ULIDs; one warning names them. To set them in
another project, create its run first and pass it in `run.ulids`.

## See also

- [Configuration](configuration.md): every option.
- [Sharding and CI](ci/sharding.md): one run for every shard.
