<p align="center">
  <a href="https://probara.net"><img src="https://raw.githubusercontent.com/cynch-me/probara-sdk/main/.github/assets/probara-mark.png" alt="Probara" width="120"></a>
</p>

<h1 align="center">@probara/cypress-reporter</h1>

<p align="center">Every Cypress attempt, with its steps and attachments, in Probara.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@probara/cypress-reporter"><img src="https://img.shields.io/npm/v/@probara/cypress-reporter?style=flat-square&color=5b3fd6&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@probara/cypress-reporter"><img src="https://img.shields.io/npm/dm/@probara/cypress-reporter?style=flat-square&color=5b3fd6" alt="npm downloads"></a>
  <a href="https://github.com/cynch-me/probara-sdk/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/cynch-me/probara-sdk/ci.yml?branch=main&style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status"></a>
  <a href="https://github.com/cynch-me/probara-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-5b3fd6?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-5b3fd6?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.12 or later">
  <img src="https://img.shields.io/badge/cypress-%3E%3D15.10.0-5b3fd6?style=flat-square&logo=cypress&logoColor=white" alt="Cypress 15.10.0 or later">
</p>

<p align="center">
  <a href="#quick-start"><b>Quick start</b></a>
  ·
  <a href="#documentation"><b>Documentation</b></a>
  ·
  <a href="https://probara.net"><b>Probara</b></a>
  ·
  <a href="https://github.com/cynch-me/probara-sdk"><b>Probara SDK</b></a>
</p>

A [Cypress](https://www.cypress.io) reporter that sends every test result of a run to
[Probara](https://probara.net): each attempt with its status, duration and error, linked to its
Probara test case, with the steps, attachments and links your tests add. Cases that are missing get
created, and the run is closed once everything is in. Built on
[`@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md).

## Features

- **Three registrations, each with its own job**: the reporter (`reporter` and `reporterOptions`)
  turns Cypress' own events into results, the plugin (`setupNodeEvents`, from
  `@probara/cypress-reporter/setup`) owns the run, registers the `probara` task, and collects the
  screenshots and the video, and the support file
  (`import '@probara/cypress-reporter/support'`) turns on the `probara.*` helpers. Registered
  together, a spec reports every attempt with everything it recorded
  ([registration](docs/configuration.md#registration)).
- **One result per attempt**, `retries` included, with Cypress' own verdict: `it.skip` and
  `this.skip()` are skipped, the attempt a `retry` stands for is failed, and every test a failing
  hook kept from running is skipped ([statuses](docs/statuses.md), [retries](docs/retries.md)).
- **The same keys as `probara import junit`** on the JUnit XML of Cypress's `junit` reporter or of
  cypress-junit, so switching from the JUnit import keeps every case and its history
  ([same cases as the JUnit import](#same-cases-as-the-junit-import)).
- **Screenshots attached to the exact attempt** Cypress took them for, plus the video of a spec for
  its failed results (`attachVideos`) ([attachments](docs/attachments.md#screenshots)).
- **Linking** by a case id in a title or a `describe` (`SHOP-12 adds an item`) or `probara.id()`,
  and the browser Cypress runs as a `browser` parameter of every result, never in the key
  ([linking](docs/linking.md), [projects](docs/projects.md)).
- **Browser helpers** that run where the test runs: `probara.step()` (nested, with expected results
  and data), `probara.attach()`, `probara.link()`, `probara.issue()`, `probara.parameters()`, and
  the title, suite, tags and fields of a new case ([metadata](docs/metadata.md),
  [steps](docs/steps.md)).
- **Console output** of each test attached with `captureOutput`
  ([attachments](docs/attachments.md#console-output)), and **run selection**: only the tests of a
  Probara run, with `runCasesOnly` ([run selection](docs/run-selection.md)).
- **Runs** by name, with an environment, milestone, test plan, configurations and tags
  ([run options](docs/runs.md)); one run for every shard of a sharded CI job
  ([sharding](docs/ci/sharding.md)); failures assigned with `assignFailedTo`
  ([assign failed](docs/assign-failed.md)).
- **Never breaks your test run**: a reporting problem is logged, never thrown, and `cypress run`
  still ends with the number of its own failed tests. What could not be sent can be kept in a file
  and sent later with `probara import results 'probara-results*.json'`.

Not ported from the reporters this one takes over from, each with its reason: Cypress commands as
steps (every command would multiply the steps of a result, and Cypress does not expose its command
events to plugins), the network profiler of Qase's reporter (a `cy.intercept` recorder and a task
per request, more noise and cost than value), updating existing cases (a report never changes a
case), a key override (`externalId`, `historyId`, `automation_id`), result fields, Cucumber steps
(another reporter's job), a case owner, masked parameters, categories and known issues, and defects
or public links ([coming from other tools](docs/coming-from-other-tools.md#not-ported)).

## Requirements

- Node.js 22.12 or later.
- Cypress 15.10.0 or later: the first version with `Cypress.expose()`, which carries the
  plugin's settings to the browser ([Cypress versions](docs/upgrade.md#cypress-and-nodejs-versions)).
- A Probara app token, created from the **Cypress** card in **Integrations**
  ([get a token](docs/configuration.md#get-a-token)), and the code of the project to report into
  (such as `SHOP`). Reporting from CI needs a paid plan.

## Install

```bash
npm install --save-dev @probara/cypress-reporter
```

## Quick start

1. In Probara, open **Workspace › Integrations**, pick the **Cypress** card and create a token
   ([get a token](docs/configuration.md#get-a-token)). Store it as a CI secret named
   `PROBARA_API_TOKEN`: the reporter reads it from the environment, never from the config.
2. Register the reporter and its plugin in the Cypress config:

   ```js
   // cypress.config.js
   const { defineConfig } = require('cypress');
   const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

   module.exports = defineConfig({
     e2e: {
       reporter: '@probara/cypress-reporter',
       reporterOptions: { projectId: 'SHOP' },
       setupNodeEvents(on, config) {
         return probaraNodeEvents(on, config);
       },
     },
   });
   ```

3. Load the browser helpers in the support file, so a spec can use `probara.*`:

   ```js
   // cypress/support/e2e.js
   import '@probara/cypress-reporter/support';
   ```

4. Run your tests with the token in the environment. In GitHub Actions:

   ```yaml
   - name: Run Cypress tests
     run: npx cypress run
     env:
       PROBARA_API_TOKEN: ${{ secrets.PROBARA_API_TOKEN }}
       PROBARA_PROJECT: SHOP
   ```

Without a token and a project the reporter stays off and quiet, so local runs send nothing. In CI
it logs on stdout, in `[probara]` lines, and ends with the link to the run:

```text
$ npx cypress run --spec cypress/e2e/cart.cy.js
[probara] Sending 5 results of 4 tests (3 passed, 2 failed, 0 skipped, 0 blocked)
[probara] Recorded 5 results (2 new cases, 0 unmatched) in R-1 (closed): https://app.probara.net/projects/SHOP/runs/R-1
```

## What gets reported

| Cypress                                                                 | In Probara                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A test                                                                  | A test case, matched by its automation key or linked by a case id         |
| Each attempt (`retries` too)                                            | A result in the run, with its status, duration, start time and error      |
| `it.skip`, `this.skip()`, a test a failing hook kept from running       | A skipped result                                                          |
| A failing `beforeEach`/`before`                                         | One failed result named as Cypress names it, plus the tests it stopped    |
| `probara.step()` calls                                                  | The steps of the result, nested, with their status, duration and error    |
| `probara.attach()`, `captureOutput`, the screenshots of a failure       | Files of the result, or of the step they were attached in                 |
| `probara.link()`, `probara.issue()`                                     | Links of the result                                                       |
| Other `probara.*` calls in the test                                     | The title, suite, tags, fields and steps of a new case; result parameters |
| A spec Cypress cannot run (a syntax error), one that throws as it loads | One failed result, as Cypress names it, so it never shows green           |
| The `cypress run` command                                               | One automated run, named after the CI build, closed at the end            |

Cypress ends a `cypress run` with the number of its own failed **tests**, and reporting changes
nothing of it: four failed tests still end the command with `4`, whatever Probara answered
([statuses](docs/statuses.md)).

## Same cases as the JUnit import

The reporter gives each test the automation key `probara import junit` gives it on the report of
Cypress's built-in `junit` reporter or of [cypress-junit](https://www.npmjs.com/package/cypress-junit)
written with their default options:
the spec file relative to the project root, then `>` between spaces, then the describes and the
`it` title joined by spaces (the name both write), without the case ids. For these two
specs:

```js
// cypress/e2e/cart.cy.js
describe('Cart', () => {
  it('SHOP-12 adds an item', () => {
    cy.get('.add').click();
  });

  it('removes an item', () => {
    cy.get('.remove').click();
  });
});
```

```js
// cypress/e2e/login.cy.js
describe('Login', () => {
  it('logs in with a valid password', () => {
    cy.get('#submit').click();
  });
});
```

the reporter sends:

```json
[
  {
    "automationKey": "cypress/e2e/cart.cy.js > Cart adds an item",
    "caseDisplayId": "SHOP-12",
    "status": "passed"
  },
  { "automationKey": "cypress/e2e/cart.cy.js > Cart removes an item", "status": "passed" },
  {
    "automationKey": "cypress/e2e/login.cy.js > Login logs in with a valid password",
    "status": "passed"
  }
]
```

If your JUnit reports were written with a `mochaFile` that one spec overwrites, or without
the `file` attribute of the root suite, set `keyIncludesFile: false`: the keys then leave the file
out ([configuration](docs/configuration.md#keyincludesfile)). Either way, a test keeps its case and
its history when you switch from the JUnit import
([migrating from the JUnit import](docs/migrating-from-junit.md)).

## Documentation

| Page                                                            | What it covers                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Configuration](docs/configuration.md)                          | The three registrations, every option, its variable and default; getting a token                |
| [Linking tests to cases](docs/linking.md)                       | Case ids in titles and describes, `probara.id()`, automation keys, `describe` and `it.only`     |
| [Metadata](docs/metadata.md)                                    | Title, suite, comment, tags, fields, parameters, ignoring an attempt; where helpers work        |
| [Steps](docs/steps.md)                                          | `probara.step()`: nesting, status, errors, Cypress commands, the steps of a new case            |
| [Attachments](docs/attachments.md)                              | `probara.attach()`, files of steps, screenshots, video, console output, limits                  |
| [Links](docs/links.md)                                          | `probara.link()`, `probara.issue()` and `issueUrlTemplate`                                      |
| [Statuses](docs/statuses.md)                                    | How attempts become statuses; `it.skip`, hooks, specs that fail; mapping and filter             |
| [Specs](docs/specs.md)                                          | `--spec`, `it.only`, retries, specs that cannot run, the spec as a suite                        |
| [Retries and flaky tests](docs/retries.md)                      | Every attempt is a result                                                                       |
| [Run options](docs/runs.md)                                     | Name, description, environment, milestone, plan, configurations, tags, an existing run, closing |
| [Sharding and CI](docs/ci/sharding.md)                          | One run for every shard                                                                         |
| [Cypress and Probara projects](docs/projects.md)                | Results to other Probara projects, `keyIncludesFile`, the browser as a parameter                |
| [Interactive mode](docs/watch.md)                               | Why `cypress open` reports nothing, and what to run instead                                     |
| [Run selection](docs/run-selection.md)                          | `runCasesOnly`: run only the tests of a Probara run                                             |
| [Assign failed results](docs/assign-failed.md)                  | `assignFailedTo`: who looks into failures                                                       |
| [Results file](docs/results-file.md)                            | Keep what could not be sent, send it later                                                      |
| [Migrating from the JUnit import](docs/migrating-from-junit.md) | From Cypress's `junit` reporter or cypress-junit and `probara import junit`, keeping every case |
| [Migrating from Qase](docs/migrating-from-qase.md)              | Option by option and call by call, what is different, what is not ported                        |
| [Coming from other tools](docs/coming-from-other-tools.md)      | Allure Cypress and TestRail's `trcli`, mapped, and what is not ported                           |
| [Troubleshooting](docs/troubleshooting.md)                      | Problems and their solutions; every line the reporter logs                                      |
| [Debugging](docs/debugging.md)                                  | `PROBARA_DEBUG`, the logs, checking what would be sent                                          |
| [Network](docs/network.md)                                      | Requests, timeouts, retries, rate limits, proxies and certificates                              |
| [Upgrading](docs/upgrade.md)                                    | Versioning policy, the automation key contract, Cypress versions                                |
| [Changelog](CHANGELOG.md)                                       | What changed in each version                                                                    |

CI guides: [GitHub Actions](docs/ci/github-actions.md), [GitLab CI](docs/ci/gitlab.md),
[CircleCI](docs/ci/circleci.md), [Azure Pipelines](docs/ci/azure-pipelines.md),
[Jenkins](docs/ci/jenkins.md), [Bitbucket Pipelines](docs/ci/bitbucket.md) and
[Buildkite](docs/ci/buildkite.md).

On the Probara side, the [Cypress integration guide](https://docs.probara.net/en/guides/integrations/cypress/)
covers the card, its app tokens and what Probara shows.

## Reporting never breaks your test run

The reporter never throws into Cypress and never changes its exit code: a failed test still fails
the command, a reporting problem does not. Every problem (a wrong setting, Probara unreachable, a
refused token) is logged, and the tests keep their outcome. `probara.*` calls never throw into a
test either: a call Probara cannot use is left out with a warning. There is no option to fail the
command on a reporting error; to keep what could not be sent, set a results file
([`resultsFile`](docs/configuration.md#results-file)).

## License

[Apache License 2.0](./LICENSE).

<br>

<p align="center">
  <sub>Part of the <a href="https://github.com/cynch-me/probara-sdk">Probara SDK</a> · <a href="https://probara.net">probara.net</a> · <a href="https://docs.probara.net">Probara docs</a></sub>
</p>
