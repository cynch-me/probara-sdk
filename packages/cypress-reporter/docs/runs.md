# Run options

A `cypress run` is one Probara run: the plugin creates it when the run begins, sends every result of
every spec into it, and closes it when Cypress awaits `after:run`. What the run is called, and what
else it carries, is what the `run.*` options decide (each with a `PROBARA_*` variable).

```js
// cypress.config.js
const { defineConfig } = require('cypress');
const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', run: { name: 'Release 2.4' } },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

```text
[probara] Recorded 5 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## The run references

| Option                   | Variable                      | What it names, and how                                                                                 |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `run.name`               | `PROBARA_RUN_NAME`            | The name of a new run. By default the CI build name (`ci #42`), else `Automated run <date> <time> UTC` |
| `run.description`        | `PROBARA_RUN_DESCRIPTION`     | What the run is for                                                                                    |
| `run.environment`        | `PROBARA_ENVIRONMENT`         | An environment by name; one that matches none is created                                               |
| `run.environmentId`      | `PROBARA_ENVIRONMENT_ID`      | The same environment by ULID                                                                           |
| `run.milestone`          | `PROBARA_MILESTONE`           | A milestone by display id (`M-3`) or by exact name                                                     |
| `run.milestoneId`        | `PROBARA_MILESTONE_ID`        | The same milestone by ULID                                                                             |
| `run.plan`               | `PROBARA_PLAN`                | A test plan by display id (`PLAN-2`) or by name: the run starts with its cases                         |
| `run.configurations`     | `PROBARA_CONFIGURATIONS`      | Configuration values by group and value (`Browser=Chrome,OS=Linux`), each group once                   |
| `run.configurationUlids` | `PROBARA_CONFIGURATION_ULIDS` | The same configurations by ULID, as a list                                                             |
| `run.tags`               | `PROBARA_RUN_TAGS`            | Tags of the run                                                                                        |
| `run.ulid`               | `PROBARA_RUN_ULID`            | An existing run to report into instead of creating one                                                 |
| `run.ulids`              | `PROBARA_RUN_ULIDS`           | The run to reuse in each project (`WEB=<ulid>,API=<ulid>`)                                             |

As variables, lists are comma-separated (`PROBARA_RUN_TAGS=nightly,smoke`,
`PROBARA_CONFIGURATIONS=Browser=Chrome,OS=Linux`).

The run's **source** (branch, commit, build URL) comes from the CI on its own: GitHub Actions,
GitLab CI, CircleCI, Azure Pipelines, Jenkins, Bitbucket Pipelines and Buildkite are detected, and
`source.branch`, `source.commit`, `source.buildUrl` (`PROBARA_BRANCH`, `PROBARA_COMMIT`,
`PROBARA_BUILD_URL`) override what was detected, one field at a time. `source: false` sends none.

## Who closes the run

| Case                                                        | Closed?                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| A new run of a `cypress run`                                | Yes, at `after:run`, whatever the exit code of the tests was  |
| A run the reporter did not create (`run.ulid`, `run.ulids`) | No: a report never closes a run it did not create             |
| A `cypress open` session                                    | No, never: one run per session ([interactive mode](watch.md)) |
| With `closeRun: true`                                       | Yes, including a reused one; `closeRuns` decides per project  |

When a run is left open, the run's own line says how to close it:

```text
[probara] The run R-1 of SHOP stays open: close it in Probara, or with probara run close --project SHOP --run-ulid 01J9Z3K4M5N6P7Q8R9S0T1V2W3
```

or, when a report failed after its retries:

```text
[probara] Could not close the run R-1: <reason>. It was left open: https://app.probara.net/projects/SHOP/runs/R-1
```

## One run per `cypress run`

The run belongs to the plugin, which is where Cypress awaits the end of the run. Two exceptions,
both visible in the run list of Probara:

- **Without the plugin** (`setupNodeEvents` not registered), each spec reports in a run of its own,
  because Cypress never tells the reporter process when a run ended
  ([registration](configuration.md#registration)).
- **A `cypress open` session** keeps one run for the whole session, which it never closes
  ([interactive mode](watch.md)).

## Several shards, one run

A sharded job runs one machine per shard. Create the run once and pass its ULID to every shard:

```bash
PROBARA_RUN_ULID=$(npx @probara/cli run create --project SHOP --run-name "Release 2.4")
export PROBARA_RUN_ULID
npx cypress run --spec 'cypress/e2e/cart.cy.js'
```

`run create` prints the ULID alone on stdout. Every shard reports into that run, and the reporter
never closes it: the job closes it when the last shard is done ([sharding](ci/sharding.md)). Nothing Cypress-specific is needed for this: the CI
build id, the spec path and the shard name never reach a key.

## Limits

Core holds a run to what Probara stores, and each kind of value is handled its own way:

- A **name** longer than 200 characters is trimmed, and a **tag** longer than 80 is too.
- **Tags** beyond 50 are dropped, with one warning (`Dropped N run tags beyond the limit of 50`).
- A **reference** (environment, milestone, plan) longer than its limit is a configuration problem
  that turns reporting off, naming the field (`run.milestone is longer than 255 characters`): it is
  a name that has to match one in Probara, and a trimmed one would match none.

## See also

- [Configuration](configuration.md#runs): every option of a run.
- [Sharding and CI](ci/sharding.md): one run for every shard, and the CI guides.
- [Interactive mode](watch.md): the one run a `cypress open` session leaves open.
- [Run selection](run-selection.md): running only the tests of a run's cases.
