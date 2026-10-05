# Migrating from Qase

The Qase Cypress reporter (`qase-cypress`, the live code of `qase-tms/qase-javascript`; the older
`qase-tms/qase-cypress` package is deprecated) sends every attempt of every test to Qase with helpers
of its own: `qase.title()`, `qase.suite()`, `qase.fields`, `qase.comment`, `qase.ignore`,
`qase.step()`, `qase.attach()`, and the case ids it reads out of the titles. This page is what maps to
what, what is named differently, and what is **not ported**, with the reason.

The Qase side of every table is the feature list of that reporter (its `reporter`, its
`setupNodeEvents` hook, the ids in titles, the screenshots and video it looks for in
`screenshotsFolder`/`videosFolder`, and `QASE_RUN_ID`). The Probara side is what this package
documents and a real `cypress run` proves.

## Registration

Both reporters register the same way in Cypress, in the two places Cypress allows, and both need a
third registration in the support file for their test-side helpers:

| What                                                  | Qase                                                  | Probara                                                                |
| ----------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| The Mocha reporter (`reporter` in the Cypress config) | `qase-cypress`                                        | `@probara/cypress-reporter` with `reporterOptions`                     |
| The plugin (`setupNodeEvents`)                        | their hook, which owns the run and collects the files | `probaraNodeEvents(on, config)` from `@probara/cypress-reporter/setup` |
| The support file                                      | their support module                                  | `import '@probara/cypress-reporter/support'`                           |

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

```js
// cypress/support/e2e.js
import '@probara/cypress-reporter/support';
```

Without the plugin, every result is still sent, but one run per spec, with no screenshot, no video
and no `probara.*` helper ([registration](configuration.md#registration)). Without the support file
every `probara.*` call does nothing, with one line on the browser console.

## Names, side by side

| In a Qase suite                                           | In a Probara suite                                      | What changes                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `(Qase ID: 12)` in an `it` or a `describe` title          | `SHOP-12` in the title, or `probara.id('SHOP-12')`      | **The id syntax changes** ([below](#linking-by-case-id))                                 |
| `qase.title()` / `qase.suite()`                           | `probara.title()` / `probara.suite()`                   | The same two calls, for the case the report creates                                      |
| `qase.fields`                                             | `probara.fields({ ... })`                               | A function call, and it only takes effect when the report creates a case                 |
| `qase.comment`                                            | `probara.comment(text)`                                 | The same, written first in the notes of the result, before the error                     |
| `qase.ignore`                                             | `probara.ignore()`                                      | The same                                                                                 |
| `qase.parameters` / `groupParameters`                     | `probara.parameters({ ... })`                           | One call for both; the browser is added as a parameter on its own                        |
| `qase.step(title, params)`                                | `probara.step(title, body?, { expected, data })`        | A body, or none; nesting by call order                                                   |
| `qase.attach({ paths \| content })`                       | `probara.attach({ name, path \| body })`                | A name is required; a path returns the chain of its `cy.task()`                          |
| `qase.projects` (a project per case id prefix)            | `projects` + the case-id prefix                         | The same routing, named [`projects`](projects.md#several-probara-projects)               |
| `QASE_REPORT` (the switch that turns Qase's reporting on) | `PROBARA_API_TOKEN` / `PROBARA_PROJECT`                 | A [Cypress card](configuration.md#get-a-token) token, read from the environment          |
| `QASE_RUN_ID`                                             | `PROBARA_RUN_ULID` (`run.ulid`)                         | The same: report into a run that already exists                                          |
| report mode                                               | nothing: it always reports                              | Off with `enabled: false`                                                                |
| The results dir of report mode                            | `resultsFile` + `probara import results`                | A JSON file of what could not be sent, sent later                                        |
| `screenshotsFolder` searched by modification time         | nothing to configure: `after:screenshot` gives the path | Attached to the exact attempt with `attachScreenshots` ([below](#screenshots-and-video)) |
| `videosFolder` searched at `after:spec`                   | `video: true` + `attachVideos`                          | Explicit, and per spec                                                                   |

## Linking by case id

This is the one change that touches your specs, so it is worth doing first.

```js
// with Qase
it('(Qase ID: 12) adds an item', () => {
  cy.get('.add').click();
});

// with Probara
it('SHOP-12 adds an item', () => {
  cy.get('.add').click();
});
```

```js
// or, without touching the title
it('adds an item', () => {
  probara.id('SHOP-12');
  cy.get('.add').click();
});
```

A Probara case id is `<PROJECT>-<number>`, where the project code is the one in `projectId` (or in
`projects`), and it is read out of the **titles** of the test and of its `describe`s: several ids
link one test to several cases, and a `describe` that names one links every test of it. The ids
never enter the automation key, so a renamed title keeps its case. `(Qase ID: 12)` is not a Probara
id and links nothing: it stays in the title and in the key, and the test gets a new case. There is
no option that reads Qase's syntax ([linking](linking.md)).

`probara.id()` is the same call as in every reporter of this package, and it runs with the test:
it cannot decide what `runCasesOnly` runs ([run selection](run-selection.md)).

## Screenshots and video

Qase's reporter finds a screenshot by searching `screenshotsFolder` for the file modified most
recently, and the video of a spec in `videosFolder` at `after:spec`. Probara takes neither path: the
plugin receives every screenshot with `after:screenshot` and the video of every spec with
`after:spec`, each with its own path, so nothing is matched by time.

| What                             | Qase                         | Probara                                                                         |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Screenshot of a failed attempt   | found in `screenshotsFolder` | attached to the result of **that** attempt (`attachScreenshots`, on by default) |
| Screenshot of a hook failure     | the same search              | attached to the synthetic hook result Cypress names                             |
| Screenshot the test named itself | not attached                 | not attached, and named once at `PROBARA_DEBUG`                                 |
| Video of the spec                | found in `videosFolder`      | `attachVideos` (off by default), to every failed result of the spec             |

Because the plugin is what receives those events, both need `setupNodeEvents`
([configuration](configuration.md#attachvideos)).

## Steps

`qase.step(title, params)` opens and closes a step around a block of Cypress commands. The Probara
call is the same shape, with the case step's expected result and data as options, and nesting by
call order:

```js
probara.step(
  'Open the cart',
  () => {
    cy.get('.cart').click();
  },
  { expected: 'The cart shows two items' },
);
```

The outermost steps are the steps of the case the report creates (that is what `qase.step` encoded
with its parameters). Two differences worth knowing: a step that failed through a Cypress command
is reported failed with the reason
([steps](steps.md)), and **Cypress commands are not turned into steps** — Qase's reporter does not
turn them into steps either, but Allure's does ([coming from other tools](coming-from-other-tools.md#allure-cypress)).

## Attachments

```js
// with Qase
qase.attach({ paths: ['reports/cart.csv'] });
qase.attach({ content: 'sku,qty\nA-1,2\n', name: 'note.txt' });

// with Probara
probara.attach({ name: 'cart.csv', path: 'reports/cart.csv' });
probara.attach({ name: 'note.txt', body: 'sku,qty\nA-1,2\n' });
```

A Probara attachment always carries a **name**, which is what it shows under in Probara, and a
`path` is read by the plugin from the project root, and a missing file is left out with a warning
instead of failing the test
([attachments](attachments.md)).

## Runs

| What                                                                  | Qase                               | Probara                                                                    |
| --------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| An existing run                                                       | `QASE_RUN_ID`                      | `run.ulid` / `PROBARA_RUN_ULID`                                            |
| Name, description, environment, milestone, plan, configurations, tags | the run options of Qase's reporter | `run.*` ([run options](runs.md))                                           |
| Who closes the run                                                    | `afterRunHook`                     | the plugin, at `after:run`; `closeRun` decides otherwise                   |
| Shards of one job                                                     | one run per shard                  | one run per shard, with `PROBARA_RUN_ULID` ([sharding](ci/sharding.md))    |
| A `cypress open` session                                              | a run per session                  | nothing: only `cypress run` reports ([interactive mode](watch.md))         |
| Report mode (a run on disk)                                           | the results dir                    | `resultsFile` + `probara import results` ([results file](results-file.md)) |
| Cases that do not exist yet                                           | created by the server              | `createMissingCases`, on by default                                        |

## Retries and skipped tests

Both reporters send **one result per attempt**: with `retries.runMode: 1`, a test that fails once
and then passes is two results of one case, the failed attempt first. Probara adds the attempt
number as a parameter (`attempt`, from the second attempt on), which Qase's reporter does not send.

An `it.skip` is a skipped result on both sides. The tests a failing `beforeEach` keeps from running
are reported **skipped** as well: Qase's reporter reports them with its `SkippedTestHandler` at the
end of the suite, and so does this one ([specs](specs.md#a-hook-that-fails)).

## Not ported

| Qase feature                                              | Why not                                                                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The network profiler (the opt-in `cy.intercept` recorder) | It needs a `cy.intercept` recorder and a task per request; the cost and the noise of every request of a suite is not worth it in a reporter that sends what the tests already recorded |
| `qase.cucumberSteps`                                      | Cucumber steps belong to a BDD preprocessor, which is another reporter's job                                                                                                           |
| A retry profile (which attempts of a test to keep)        | Probara has no profile concept: every attempt is a result, and `statusMapping` and `statusFilter` are the only rules that change or drop one                                           |
| Custom run hooks (`beforeRunHook`, `afterRunHook`)        | The plugin owns the lifecycle: it creates the run, completes it and closes it at `after:run`, and `closeRun` decides whether it is closed                                              |

## See also

- [Coming from other tools](coming-from-other-tools.md): Allure Cypress and trcli, and the full
  not-ported list.
- [Configuration](configuration.md): every option and its variable.
- [Migrating from the JUnit import](migrating-from-junit.md): the key contract.
