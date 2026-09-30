# Several projects

One Playwright suite can hold the tests of several Probara projects: a shared end-to-end suite
whose cases live in `SHOP`, `WEB` and `API`. List the other projects in `projects`, and each
result goes to the project of its case, into a run of that project.

<!-- project: projects -->

```ts
reporter: [['@probara/playwright-reporter', { projectId: 'SHOP', projects: ['WEB'] }]],
```

<!-- project: projects -->

```ts
// tests/shared.spec.ts
import { test } from '@playwright/test';

test('SHOP-12 pays', async () => {});

test('WEB-3 shows the landing page', async () => {});

test(
  'answers the health check',
  { annotation: { type: 'probara_case', description: 'API-7' } },
  async () => {},
);

test('opens the help', async () => {});
```

<!-- output: projects -->

```text
$ npx playwright test
[probara] Did not send the results linked to cases of API: API is neither the project (SHOP) nor one of projects (PROBARA_PROJECTS) (first seen in "answers the health check"; repeats are logged at debug)
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked); 1 linked only to cases of unlisted projects
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 of SHOP (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Recorded 1 result (0 new cases, 0 unmatched) in R-2 of WEB (closed): https://app.probara.net/projects/WEB/runs/R-2
```

## What goes where

- **By the case's project.** A result linked to `WEB-3` goes into a run of `WEB`. The ids of every
  listed project link from titles too, and leave the key, like the configured project's.
- **A test linked to cases of several projects** is sent once per case, each to its project, with
  its files uploaded to each result.
- **A test without a case** goes to the configured project (`projectId`), where it is matched by
  its key or created: automation keys belong to one project, so only the configured project creates
  cases, under `suiteUlid`.
- **A case of a project that is not listed** is not sent: it would land in the wrong project, where
  Probara refuses its id. One warning per project says so, and the count of the log leaves those
  attempts out. List the project to report it.

`PROBARA_PROJECTS=WEB,API` lists them from the environment.

## One run per project

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
PROBARA_RUN_ULIDS="WEB=$WEB_RUN" PROBARA_PROJECTS=WEB npx playwright test
```

`run.ulids` (`PROBARA_RUN_ULIDS=SHOP=<ulid>,WEB=<ulid>`) names the run to reuse in each project;
the configured project's entry counts as `run.ulid`. A reused run stays open unless `closeRun` is
`true`: close it with `probara run close --project WEB --run-ulid <ulid>`.

## Sharded jobs

Create one run per project before the shards, pass them all in `PROBARA_RUN_ULIDS`, and close them
after the last shard ([sharding](ci/sharding.md)):

```bash
SHOP_RUN=$(npx @probara/cli run create)
WEB_RUN=$(npx @probara/cli run create --project WEB)
export PROBARA_PROJECTS=WEB PROBARA_RUN_ULIDS="SHOP=$SHOP_RUN,WEB=$WEB_RUN"
npx playwright test --shard=1/2
npx @probara/cli run close --run-ulid "$SHOP_RUN"
npx @probara/cli run close --project WEB --run-ulid "$WEB_RUN"
```

When the configured project's run is reused but a listed project has no run in `run.ulids`, each
shard creates its own run in that project, and a warning says so.

## Failures

A failed report stops only its project: the others go on. The log names the project of every
error (`WEB: ...`), and a [results file](results-file.md) keeps what each project could not send,
with the run it goes back into: one file for the whole run, which
`probara import results 'probara-results*.json'` sends to each project.

## See also

- [Linking](linking.md): case ids.
- [Run options](runs.md).
