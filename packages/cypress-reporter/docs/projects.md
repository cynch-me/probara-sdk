# Cypress and Probara projects

One Cypress project can report into several Probara projects. What decides where a result goes is
**the case ids in its titles**, and which projects are allowed to receive them is the `projects`
option.

```js
// cypress.config.js
module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', projects: ['WEB'] },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

```bash
PROBARA_PROJECTS=WEB npx cypress run
```

## Several Probara projects

A test whose title (or whose `describe`'s title) names a case of a project in `projects` is reported
into **that** project:

```js
// cypress/e2e/cart.cy.js
describe('SHOP-7 Checkout', () => {
  it('WEB-3 keeps another project id in its title', () => {
    cy.get('.checkout').click();
  });
});
```

```text
cypress/e2e/cart.cy.js > Checkout pays by card                       → SHOP, case SHOP-7
cypress/e2e/cart.cy.js > Checkout WEB-3 keeps another project id …    → SHOP, case SHOP-7, `WEB-3` still in the key
```

Both are the same two results a real run sends: `WEB-3` is not in `projects`, so it is not read as a
case id at all — it stays in the title and in the key — and the case the test links is `SHOP-7`, from
the `describe` above it.

Case ids are read out of titles for the configured project (`projectId`) **and** for the projects in
`projects`, and for no other: `WEB-3` without `projects: ['WEB']` stays in the title and in the key,
and the test goes to `SHOP` like every other.

Each project gets **its own run**, named after the same settings, unless `run.ulids` names one per
project:

```js
reporterOptions: {
  projectId: 'SHOP',
  projects: ['WEB'],
  run: { ulids: { SHOP: '01J9…', WEB: '01J9…' } },
}
```

```bash
PROBARA_RUN_ULIDS=SHOP=01J9Z3K4M5N6P7Q8R9S0T1V2W3,WEB=01J9Z3K4M5N6P7Q8R9S0T1V2W4 npx cypress run
```

Each of those runs keeps its own setting for `closeRun` or `closeRuns` (a reused run is never closed
by a report). The `Recorded` line names the project when there is more than one: `in R-1 of WEB`.

## A result with no project to go to

A test linked **only** to cases of projects that are not listed cannot be recorded anywhere: it is
left out, and the `Sending` line says how many:

```text
[probara] Sending 3 results of 3 tests (3 passed, 0 failed, 0 skipped, 0 blocked); 1 linked only to cases of unlisted projects
```

Nothing is lost silently, and the run goes on. The fix is in the titles: list the project, or name a
case of the project the test reports into (`probara.id('SHOP-12')` counts here, where it does not
count for [run selection](run-selection.md#what-a-test-must-match)).

## Cypress projects are not Probara projects

A Cypress project (what `defineConfig` calls one: an `e2e` block, a `component` block) says nothing
about where a result goes: the spec path and the full title build the key, and the key is the same
whatever block ran the spec. Two `e2e` configs reporting with the same reporter into the same
Probara project produce the same keys, so the same cases; nothing Cypress-specific enters a key, and
`rootDir` (Cypress's `projectRoot`) is what the spec path is relative to
([linking](linking.md#automation-keys)).

## What the browser and the case suite do not change

The browser Cypress runs is a **parameter** of every result (`browser`, with `browserAsParameter`),
never part of the key, so a suite run on `chrome` and on `electron` records into one case with both
browsers in its history ([configuration](configuration.md#browserasparameter)).

The suite of a case the report creates is the spec path and its describes, in every project alike
([specs](specs.md#the-spec-as-the-suite-of-a-case)).

## See also

- [Linking](linking.md): case ids in titles, `probara.id()`, and what an automation key is.
- [Run options](runs.md): `run.ulids`, one run per project, and who closes them.
- [Configuration](configuration.md#several-probara-projects): the option and its variable.
