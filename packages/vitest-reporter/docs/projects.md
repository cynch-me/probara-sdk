# Vitest projects and Probara projects

Two different things are called projects here. Vitest's
[`projects`](https://vitest.dev/guide/projects) split one `vitest` command into several
configurations (a `unit` and a `smoke` one, say); the reporter's `projects` option lets one test
suite report to several Probara projects. Each works on its own.

| You have                                                | Read                                                  |
| ------------------------------------------------------- | ----------------------------------------------------- |
| A Vitest config with `projects: [...]`                  | [Vitest projects](#vitest-projects)                   |
| Tests whose cases live in more than one Probara project | [Several Probara projects](#several-probara-projects) |

## Vitest projects

Register the reporter once, in the root config, next to `projects`: Vitest runs one set of reporters
for all its projects, and the reporter sends every project's tests into one Probara run. It adds its
setup file and runner to each project itself.

<!-- project: vitest-projects -->

```ts
// vitest.config.mts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP' }]],
    projects: [
      { test: { name: 'unit', include: ['tests/**/*.test.ts'] } },
      { test: { name: 'smoke', include: ['tests/cart.test.ts'] } },
    ],
  },
});
```

<!-- project: vitest-projects -->

```ts
// tests/cart.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('adds an item', () => {
  probara.parameters({ currency: 'EUR' });
});
```

<!-- project: vitest-projects -->

```ts
// tests/orders.test.ts
import { test } from 'vitest';

test('lists the orders', () => {});
```

<!-- sent: vitest-projects -->

```json
[
  {
    "automationKey": "tests/cart.test.ts > adds an item",
    "parameters": { "project": "unit", "currency": "EUR" }
  },
  {
    "automationKey": "tests/orders.test.ts > lists the orders",
    "parameters": { "project": "unit" }
  },
  {
    "automationKey": "tests/cart.test.ts > adds an item",
    "parameters": { "project": "smoke", "currency": "EUR" }
  }
]
```

- **Keys have no project.** As in Vitest's JUnit output, a Vitest project adds nothing to the
  automation key: the file (relative to the Vitest root), then the names. Moving tests between
  Vitest projects keeps their cases.
- **A file that two projects run** (their `include` overlap, as `tests/cart.test.ts` above) is
  reported once per project, under the same key: two results of one case, like two retries.
- **The `project` parameter** names the Vitest project of each result when the config has more than
  one. A config with one project, or none, sends no `project` parameter. A `project` you set with
  [`probara.parameters()`](metadata.md#parameters) wins over Vitest's; `attempt` and `repeat` win
  over both.
- **Each project's run of a file is a test of its own**: its attempts, `probara.*` calls and files
  stay with that project's result, as `currency` above shows.
- **Nothing to add per project.** The reporter puts its setup file first in each project's
  `setupFiles` (your own setup files keep their order) and wraps each project's `runner`, so
  retries, [run selection](run-selection.md) and the helpers work in every project. A browser
  project gets the browser setup file instead ([browser mode](browser-mode.md)).

## Several Probara projects

One Vitest suite can hold the tests of several Probara projects: a shared suite whose cases live in
`SHOP`, `WEB` and `API`. List the other projects in `projects`, and each result goes to the project
of its case, into a run of that project.

<!-- project: probara-projects -->

```ts
reporters: ['default', ['@probara/vitest-reporter', { projectId: 'SHOP', projects: ['WEB'] }]],
```

<!-- project: probara-projects -->

```ts
// tests/shared.test.ts
import { probara } from '@probara/vitest-reporter';
import { test } from 'vitest';

test('SHOP-12 pays', () => {});

test('WEB-3 shows the landing page', () => {});

test('API-7 answers the health check', () => {});

test('opens the help', () => {
  probara.id('API-9');
});
```

<!-- output: probara-projects -->

```text
$ npx vitest run
[probara] Did not send the results linked to cases of API: API is neither the project (SHOP) nor one of projects (PROBARA_PROJECTS) (first seen in "opens the help"; repeats are logged at debug)
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked); 1 linked only to cases of unlisted projects
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 of SHOP (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Recorded 1 result (0 new cases, 0 unmatched) in R-2 of WEB (closed): https://app.probara.net/projects/WEB/runs/R-2
```

`PROBARA_PROJECTS=WEB,API` lists them from the environment.

### What goes where

- **By the case's project.** A result linked to `WEB-3` goes into a run of `WEB`. The ids of every
  listed project link from titles too, and leave the key, like the configured project's.
- **A test linked to cases of several projects** is sent once per case, each to its project, with
  its files uploaded to each result.
- **A test without a case** goes to the configured project (`projectId`), where it is matched by
  its key or created: automation keys belong to one project, so only the configured project creates
  cases, under `suiteUlid`.
- **An id of a project that is not listed** in a title (`API-7` above) is no id: it stays in the
  title and the key, like any text, and the test goes to the configured project. Given to
  `probara.id()` (`API-9`), it is a case the reporter cannot send anywhere: the result would land
  in the wrong project, where Probara refuses its id. It is left out, with one warning per project,
  and the count of the `Sending` line says so. List the project to report it.

### One run per project

Each listed project gets its own run, created with its first result (a project without results
gets no run), with the same name, description, environment (by name), tags and CI source as the
configured project's, and closed at the end like any run the reporter creates.

The milestone, plan and configurations are planning entities of one project: a name that exists
in `SHOP` may not exist in `WEB`, where Probara would refuse the whole report. So `run.milestone`,
`run.plan` and `run.configurations`, like their ULID forms (`run.milestoneId`,
`run.configurationUlids`, `run.environmentId`), only go with the configured project's run, and one
warning names them. To give another project's run its own, create it first and reuse it:

```bash
WEB_RUN=$(npx @probara/cli run create --project WEB --milestone "Web sprint 4")
PROBARA_RUN_ULIDS="WEB=$WEB_RUN" PROBARA_PROJECTS=WEB npx vitest run
```

`run.ulids` (`PROBARA_RUN_ULIDS=SHOP=<ulid>,WEB=<ulid>`) names the run to reuse in each project;
the configured project's entry counts as `run.ulid`. A reused run stays open unless `closeRun` is
`true`: close it with `probara run close --project WEB --run-ulid <ulid>`.

### Sharded jobs

Shards that each send their own results (no `blob` reporter) share runs the same way: create one
run per project before the shards, pass them all in `PROBARA_RUN_ULIDS`, and close them after the
last shard ([sharding](ci/sharding.md#pattern-2-create-the-run-report-from-each-shard-close-it)):

```bash
SHOP_RUN=$(npx @probara/cli run create)
WEB_RUN=$(npx @probara/cli run create --project WEB)
export PROBARA_PROJECTS=WEB PROBARA_RUN_ULIDS="SHOP=$SHOP_RUN,WEB=$WEB_RUN"
npx vitest run --shard=1/2
npx vitest run --shard=2/2
npx @probara/cli run close --run-ulid "$SHOP_RUN"
npx @probara/cli run close --project WEB --run-ulid "$WEB_RUN"
```

When the configured project's run is reused but a listed project has no run in `run.ulids`, each
shard creates its own run in that project, and a warning says so. Shards that write a blob send
nothing: `vitest --merge-reports` reports every project's results once, as one run does.

### Failures

A failed report stops only its project: the others go on. The log names the project of every error
(`WEB: ...`), and a [results file](results-file.md) keeps what each project could not send, with
the run it goes back into: one file for the whole run, which
`probara import results 'probara-results*.json'` sends to each project.

## See also

- [Linking](linking.md): case ids and keys.
- [Run options](runs.md): the run each project gets.
- [Watch mode](watch.md): one run per project per session.
