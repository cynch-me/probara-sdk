# Coming from other tools

Two other reporters are common in a Cypress suite: **Allure Cypress** (a plugin that writes an
Allure result file) and **TestRail's `trcli`** (a command that uploads a JUnit file after the run).
Neither sends results while the tests run: both read what a file holds afterwards. This reporter
reads Cypress' own events, so it needs no file, and every attempt reaches Probara as it ends.

## Allure Cypress

Allure's Cypress plugin registers in `setupNodeEvents` and publishes its API in the support file:

```js
const { defineConfig } = require('cypress');
const allureCypress = require('allure-cypress');

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      allureCypress(on, config);
    },
  },
});
```

```js
// cypress/support/e2e.js
import 'allure-cypress';
```

The Probara side is the [registration](configuration.md#registration) of this package: the
`@probara/cypress-reporter` reporter, `probaraNodeEvents(on, config)`, and
`@probara/cypress-reporter/support` in the support file.

| Allure Cypress                                        | Probara                                              | What changes                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `allure.step(name, body)`                             | `probara.step(title, body?, { expected, data })`     | `expected` and `data` are the case step's expected result and data                                               |
| `stepsFromCommands` (every Cypress command a step)    | nothing: commands are not steps                      | [Below](#why-cypress-commands-are-not-steps)                                                                     |
| `allure.attachment(name, content, type)`              | `probara.attach({ name, body })`                     | A name is required; the plugin reads a `path` from the project root                                              |
| `allure.link(url, name)` / `allure.issue(id)`         | `probara.link(url, name?)` / `probara.issue(id)`     | An issue becomes a link through [`issueUrlTemplate`](configuration.md#issueurltemplate)                          |
| `allure.tms` (a TestRail case link)                   | `probara.link(url, name?)`                           | A plain link with whatever URL your tracker uses                                                                 |
| `displayName`, `description`, `severity`, `owner`     | `probara.title()`, `probara.fields({ ... })`         | `owner` is not ported ([below](#not-ported)); severity and description are fields of the case the report creates |
| `allure.tags` (labels)                                | `probara.tags('smoke', 'cart')`                      | Tags of the created case                                                                                         |
| `allure.parameter(name, value)`                       | `probara.parameters({ name: value })`                | Masked parameters are not ported ([below](#not-ported)); the browser is added as a parameter on its own          |
| `historyId` (a key of your own)                       | nothing: the key is the spec path and the full title | [Below](#not-ported)                                                                                             |
| `cypress_skipped_test` (a test a failing hook kept)   | a **skipped** result for it                          | Same idea, reported as a status                                                                                  |
| The video of a spec (`results.video` at `after:spec`) | `video: true` + `attachVideos`                       | Off by default: one upload per failed result                                                                     |
| `after:run` ends the result file                      | `after:run` completes and closes the Probara run     | The run is created, sent and closed by the plugin                                                                |
| The results dir when nothing could be written         | `resultsFile` + `probara import results`             | A JSON file, sent later                                                                                          |
| Environment information in the run                    | `run.environment`                                    | By name, created when none matches                                                                               |
| `isInteractive` ends the spec from the browser        | `config.isInteractive` opens one run per session     | The run is never closed ([interactive mode](watch.md))                                                           |

### Why Cypress commands are not steps

Allure's `stepsFromCommands` turns **every** Cypress command into a step, so a test that clicks,
types and asserts has a long list of steps in Allure. This reporter does not, for two reasons: every
command would multiply the steps of a result (Probara keeps 200 per result, and a suite of UI tests
reaches that in a few tests), and Cypress does not expose its command events to a plugin, so the
only honest source of a step is the test itself. `probara.step()` is that source
([steps](steps.md)); Qase's `qase.step()` behaves the same way.

## TestRail's `trcli`

`trcli` is a command, not a reporter: it reads the JUnit XML of the run and uploads it, so the
Cypress config never changes. Its flags for that are the credentials (`--project`, `--suite`,
`--user`, `--password`), the run to create or reuse (`--add-run`, `--close-run`, `--milestone`,
`--plan`, `--configuration`, `--refs`), and the command that uploads the files (`parse_junit`,
with `--run-id` and `--file`).

| trcli                                          | Probara                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--user` / `--password` / `--project`          | `PROBARA_API_TOKEN` (the [Cypress card](configuration.md#get-a-token)) and `projectId`                            |
| `--add-run`, `--close-run`                     | the run is created and closed for you; `run.ulid` reuses one                                                      |
| `--milestone`, `--plan`, `--configuration`     | `run.milestone`, `run.plan`, `run.configurations`                                                                 |
| `--refs`                                       | nothing: a Probara run has no custom reference fields; `run.tags` is what it takes                                |
| `parse_junit`                                  | nothing: the results are sent as each spec ends                                                                   |
| `-a`, `--assign`                               | `assignFailedTo` ([assign failed](assign-failed.md))                                                              |
| `--case-fields`                                | `probara.fields({ ... })` for the case the report creates                                                         |
| `--case-matcher`                               | nothing: the automation key is the spec path and the full title ([migrating from JUnit](migrating-from-junit.md)) |
| `--special-parser`, `--allow-ms`               | nothing: nothing is parsed, so no rule table to extend                                                            |
| `--result-fields`                              | not ported ([below](#not-ported))                                                                                 |
| `--update-existing-cases`, `--update-strategy` | not ported ([below](#not-ported))                                                                                 |
| `automation_id` / a `C123` in the title        | a case id in the title (`TS-1`), or `probara.id('TS-1')`                                                          |
| A run to report into (`--run-id`)              | `PROBARA_RUN_ULID`                                                                                                |

Coming from the JUnit import instead of `trcli` is the [other migration page](migrating-from-junit.md):
the keys are the same on both paths.

## Not ported

Every feature the other tools have that this reporter does not, with the reason. Each is a decision,
not a gap in progress:

| Feature                                                                          | Why                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cypress commands as steps (Allure's `stepsFromCommands`)                         | Every command would multiply the steps of a result (Probara keeps 200 per result), and Cypress does not expose its command events to a plugin                                  |
| The network profiler (Qase's opt-in `cy.intercept` recorder)                     | It needs a `cy.intercept` recorder and a task per request: the cost and the noise of every request of a suite is not worth it in a reporter that sends what the tests recorded |
| A key of your own (Allure's `historyId`, trcli's `automation_id`)                | The key is the contract with `probara import junit` (the spec path and the full title): an override would rename every case the import knows                                   |
| Updating existing cases (trcli's `--update-existing-cases`, `--update-strategy`) | A report never changes a case. A case's fields, tags and description are changed in Probara, where the change is reviewable                                                    |
| Result fields (trcli's `--result-fields`)                                        | Probara has no result fields                                                                                                                                                   |
| Cucumber steps (Qase's `cucumberSteps`, trcli's `parse_cucumber`)                | Cucumber steps belong to a BDD preprocessor, which is a separate reporter with its own parsing rules                                                                           |
| A case owner (Allure's `owner`)                                                  | Probara has no case owner field                                                                                                                                                |
| Masked parameters (Allure's `parameter(name, value, { masked: true })`)          | Probara has no masked values: every parameter is sent, and none is hidden                                                                                                      |
| Categories, known issues and mute (Allure's categories)                          | Not ported                                                                                                                                                                     |
| Defects, a Jira integration and a public link (Allure's defect links)            | Not ported; `probara.issue()` and `probara.link()` are what a result carries                                                                                                   |
| A retry profile (Qase's profiles of attempts)                                    | Probara has no profile concept: every attempt is a result, and `statusMapping` and `statusFilter` are the only rules that change or drop one                                   |
| Custom run hooks (Qase's `beforeRunHook`, `afterRunHook`)                        | The plugin owns the lifecycle: it creates the run, completes it and closes it at `after:run`, and `closeRun` decides whether it is closed                                      |

## See also

- [Migrating from Qase](migrating-from-qase.md): the same questions, for the Qase reporter.
- [Migrating from the JUnit import](migrating-from-junit.md): the key contract.
- [Configuration](configuration.md): every option and its variable.
