# Jest projects and Probara projects

Two different things are called projects here. Jest's
[`projects`](https://jestjs.io/docs/configuration#projects-arraystring--projectconfig) split one
`jest` command into several configs (a `node` and a `jsdom` one, say); the reporter's `projects`
option lets one test suite report to several Probara projects. Each works on its own.

| You have                                                | Read                                                  |
| ------------------------------------------------------- | ----------------------------------------------------- |
| A Jest config with `projects: [...]`                    | [Jest projects](#jest-projects)                       |
| Tests whose cases live in more than one Probara project | [Several Probara projects](#several-probara-projects) |

## Jest projects

Register the reporter once, at the top level of the config, next to `projects`: Jest runs one set
of reporters for all its projects, and the reporter sends every project's tests into one Probara
run.

<!-- project: jest-projects -->

```js
module.exports = {
  reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
  projects: [
    {
      displayName: 'api',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/api/**/*.test.js'],
    },
    { displayName: 'ui', testEnvironment: 'jsdom', testMatch: ['<rootDir>/tests/ui/**/*.test.js'] },
  ],
};
```

<!-- project: jest-projects -->

```js
// tests/api/orders.test.js
test('lists the orders', () => {});
```

<!-- project: jest-projects -->

```js
// tests/ui/cart.test.js
test('shows the cart', () => {
  document.body.innerHTML = '<p>2 items</p>';
});
```

<!-- sent: jest-projects -->

```json
[
  { "automationKey": "tests/ui/cart.test.js > shows the cart" },
  { "automationKey": "tests/api/orders.test.js > lists the orders" }
]
```

- **Keys have no project.** As in jest-junit's report, a Jest project adds nothing to the
  automation key: the file (relative to the directory `jest` runs in, not to the project's
  `rootDir`), then the names. Moving tests between Jest projects keeps their cases.
- **A file that two projects run** (their `testMatch` overlap, such as a shared folder) is reported
  once per project, under the same key: two results of one case, like two retries.
- **Helpers in a file two projects run at once.** Jest may run both at the same moment, in two
  workers, and a `probara.*` call cannot tell which project's run it belongs to. What the helpers
  said about that file's tests is then left out, with one warning that names the file; the results
  are sent all the same. Give each project its own files, or run with `--runInBand`, to keep them.
- **Setup files per project.** `setupFilesAfterEnv: ['@probara/jest-reporter/setup']` (for
  [`captureOutput`](attachments.md#console-output) and [run selection](run-selection.md)) is a
  project option: give it to every project whose tests need it.

### `{displayName}` in a title

jest-junit fills `{displayName}` in a test's name with the name of the Jest project that runs it,
and so does the reporter, so a test that runs in two projects can have a key, and a case, per
project:

<!-- project: display-name -->

```js
module.exports = {
  reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],
  projects: [
    { displayName: 'node', testEnvironment: 'node' },
    { displayName: 'browser', testEnvironment: 'jsdom' },
  ],
};
```

<!-- project: display-name -->

```js
// tests/format.test.js
test('formats prices in {displayName}', () => {});
```

<!-- sent: display-name -->

```json
[
  { "automationKey": "tests/format.test.js > formats prices in browser" },
  { "automationKey": "tests/format.test.js > formats prices in node" }
]
```

A project without a `displayName` fills in `undefined`, as jest-junit does. When the two projects
run such a file at the same moment, each sends only the last attempt of such a test, with one
warning: Jest does not say which project a single attempt belongs to until the file ends.

## Several Probara projects

One Jest suite can hold the tests of several Probara projects: a shared suite whose cases live in
`SHOP`, `WEB` and `API`. List the other projects in `projects`, and each result goes to the project
of its case, into a run of that project.

<!-- project: probara-projects -->

```js
reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP', projects: ['WEB'] }]],
```

<!-- project: probara-projects -->

```js
// tests/shared.test.js
const { probara } = require('@probara/jest-reporter');

test('SHOP-12 pays', () => {});

test('WEB-3 shows the landing page', () => {});

test('API-7 answers the health check', () => {});

test('opens the help', () => {
  probara.id('API-9');
});
```

<!-- output: probara-projects -->

```text
$ npx jest
[probara] Did not send the results linked to cases of API: API is neither the project (SHOP) nor one of projects (PROBARA_PROJECTS) (first seen in "opens the help"; repeats are logged at debug)
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked); 1 linked only to cases of unlisted projects
[probara] Recorded 2 results (1 new case, 0 unmatched) in R-1 of SHOP (closed): https://app.probara.net/projects/SHOP/runs/R-1
[probara] Recorded 1 result (0 new cases, 0 unmatched) in R-2 of WEB (closed): https://app.probara.net/projects/WEB/runs/R-2
```

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
  and the count of the log says so. List the project to report it.

`PROBARA_PROJECTS=WEB,API` lists them from the environment.

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
PROBARA_RUN_ULIDS="WEB=$WEB_RUN" PROBARA_PROJECTS=WEB npx jest
```

`run.ulids` (`PROBARA_RUN_ULIDS=SHOP=<ulid>,WEB=<ulid>`) names the run to reuse in each project;
the configured project's entry counts as `run.ulid`. A reused run stays open unless `closeRun` is
`true`: close it with `probara run close --project WEB --run-ulid <ulid>`.

### Sharded jobs

Create one run per project before the shards, pass them all in `PROBARA_RUN_ULIDS`, and close them
after the last shard ([sharding](ci/sharding.md)):

```bash
SHOP_RUN=$(npx @probara/cli run create)
WEB_RUN=$(npx @probara/cli run create --project WEB)
export PROBARA_PROJECTS=WEB PROBARA_RUN_ULIDS="SHOP=$SHOP_RUN,WEB=$WEB_RUN"
npx jest --shard=1/2
npx jest --shard=2/2
npx @probara/cli run close --run-ulid "$SHOP_RUN"
npx @probara/cli run close --project WEB --run-ulid "$WEB_RUN"
```

When the configured project's run is reused but a listed project has no run in `run.ulids`, each
shard creates its own run in that project, and a warning says so.

### Failures

A failed report stops only its project: the others go on. The log names the project of every error
(`WEB: ...`), and a [results file](results-file.md) keeps what each project could not send, with
the run it goes back into: one file for the whole run, which
`probara import results 'probara-results*.json'` sends to each project.

## See also

- [Linking](linking.md): case ids and keys.
- [Run options](runs.md).
- [Watch mode](watch.md): one run per project per session.
