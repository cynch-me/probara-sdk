# Probara Snap

Probara Snap compares screenshots of your pages between commits. A test takes them with
`cy.probaraSnap`, and the plugin uploads them at the end of `cypress run` as one build of the
commit. Probara compares each one with its baseline and shows the changes for review. A change
never fails the test or the run.

It needs the three registrations of the [quick start](../README.md#quick-start): the reporter, the
plugin (`probaraNodeEvents`, which uploads) and the support file (which adds the command).

## Take a screenshot

```js
// cypress/e2e/checkout.cy.js
describe('Checkout', () => {
  it('pays by card', () => {
    cy.visit('/checkout');
    cy.probaraSnap('checkout');

    cy.contains('button', 'Pay').click();
    cy.probaraSnap('checkout-paid', { fullPage: true, mask: ['.order-number'] });
  });
});
```

`cy.probaraSnap` is a Cypress command: it runs in the order of the commands around it. Cypress takes
the picture (`cy.screenshot`), into a `probara-snap` folder of `screenshotsFolder`. The last log
line of the run is the page of the build:

```text
[probara] Sent 2 screenshots to the Snap build #1 (2 new files): https://app.probara.net/projects/SHOP/snap/builds/1
```

A file Probara already holds is not uploaded again, so a run whose pages did not change uploads
nothing new. A run that takes no screenshot sends nothing to Probara Snap.

In a TypeScript project the command is typed once the support file imports
`@probara/cypress-reporter/support`.

## Names

A screenshot is identified by its test, its name, the browser, the viewport and the color scheme:
the same name in Chrome and in Firefox, or at two viewports, is two screenshots.

- A name must be unique within a test. Using one twice fails the test with
  `probaraSnap(): the name "checkout" is already used in this test`.
- Two tests may take the same name: each keeps its own screenshot.
- A retried test takes its screenshots again: only those of its last attempt are sent.

Each screenshot is linked to its test, and to the cases the test links
([linking](linking.md)).

## What `cy.probaraSnap` does before the capture

It waits for the fonts of the page, stops CSS animations and transitions (with Cypress's own
`disableTimersAndAnimations`), and hides the text caret. The page is left as it was once the
screenshot is taken. Wait for your own content (images, data) before calling it, as before any
screenshot, and set the viewport (`cy.viewport()`, or `viewportWidth` and `viewportHeight`) so every
run captures at the same size.

## Options

| Option      | Type       | Default           | What it does                                                            |
| ----------- | ---------- | ----------------- | ----------------------------------------------------------------------- |
| `fullPage`  | `boolean`  | `false`           | Take the whole scrollable page instead of the viewport                  |
| `mask`      | `string[]` | none              | Black out the elements of these CSS selectors (Cypress's `blackout`)    |
| `hide`      | `string[]` | none              | Make the elements of these CSS selectors invisible, keeping their space |
| `remove`    | `string[]` | none              | Take the elements of these CSS selectors out of the layout              |
| `threshold` | `number`   | Probara's default | How different two pixels must be to count as a change, from 0 to 1      |

To mask or hide an element from the markup instead of from every test, give it an attribute:
`<time data-probara-snap-hide>` is hidden and `<img data-probara-snap-mask>` is masked in every
screenshot.

## The commit and the branch

A build belongs to a commit and a branch, read from the CI
([run references](configuration.md#run-references)). On a GitHub Actions `pull_request` event the
commit is the head of the pull request, not the merge commit GitHub checks out, and the base branch
and the pull request number are sent too. Outside a known CI, set `PROBARA_COMMIT` (the full
40-character SHA) and `PROBARA_BRANCH`.

One `cypress run` sends one build, named `default`. To send several builds for one commit (a
desktop and a mobile run, say), give each `cypress run` its own `snapBuildName`
(`PROBARA_SNAP_BUILD_NAME`).

## Specs split across machines

A `cypress run` is a build of its own unless you say otherwise. When the specs of one pipeline are
split across machines, set `snap: true` (`PROBARA_SNAP=true`) on **every** machine: each one then
joins one build by the nonce they share, and a last job completes the build with
[`probara snap finalize`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#probara-snap-finalize).

```js
// cypress.config.js
const { defineConfig } = require('cypress');
const { probaraNodeEvents } = require('@probara/cypress-reporter/setup');

module.exports = defineConfig({
  e2e: {
    reporter: '@probara/cypress-reporter',
    reporterOptions: { projectId: 'SHOP', snap: true },
    setupNodeEvents(on, config) {
      return probaraNodeEvents(on, config);
    },
  },
});
```

1. Every machine runs its specs with `snap` on. A machine whose specs took no screenshot joins the
   build too, which is why the option is needed and not only the screenshots.
2. A final job runs `npx @probara/cli snap finalize` after every machine, **even when tests
   failed**. Until then the build waits and nothing is compared.

This works however Cypress splits the specs: Cypress Cloud `--record --parallel`, or `--spec` per
machine.

| Setting                                     | What it is                                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snap` (`PROBARA_SNAP`)                     | `true` on every machine of the split run                                                                                                                                           |
| `snapNonce` (`PROBARA_SNAP_NONCE`)          | What the machines and the final job share. Detected from the CI: the run id and attempt on GitHub Actions, the pipeline id elsewhere. Set it yourself when your CI is not detected |
| `snapBuildName` (`PROBARA_SNAP_BUILD_NAME`) | The same on every machine, and `--build-name` of the final job, when the commit gets several builds                                                                                |

The final job resolves the nonce and the build name the way the machines do, so on a detected CI
`probara snap finalize` needs no option beyond the token and the project.

- With `snap` on and no nonce (a CI that is not detected, or your own computer), nothing is sent and
  one line says how to set `PROBARA_SNAP_NONCE`.
- Leave `snap` off for a run on one machine: it would wait for a finalize too.
- A machine of a `--parallel` run without `snap` still joins the build when it took screenshots,
  and warns once that the option is missing: a machine without screenshots then sends nothing, and
  the finalize finds no build when none of them took any.
- A machine that joins after the finalize is refused. Re-running the pipeline is a new attempt on
  GitHub Actions and a new pipeline elsewhere, so it gets a new nonce and a new build.

See [sharding](ci/sharding.md#how-the-specs-get-split) for how the results of the machines reach
one Probara run.

## `cypress open`

In `cypress open` the command takes no screenshot and nothing is sent: a build belongs to a commit
of a `cypress run`.

## Failure screenshots

The screenshots Cypress takes of a failed attempt and the files a test attaches stay
[attachments](attachments.md#screenshots) of the result. Only `cy.probaraSnap` sends screenshots to
Probara Snap, and they are not attached to the result.

## When the upload fails

Like every reporting problem, a failed upload is logged and never changes the exit code of
`cypress run`. Each plan includes a number of Snap screenshots per month; once it is used up,
Probara refuses the screenshots of the job and one line says so, starting with
`[probara] Could not send the Snap screenshots:`. The test results are recorded all the same.

Without the plugin, the command takes nothing and the browser console says so once:
`cy.probaraSnap() takes no screenshot: the Cypress config registers no plugin of @probara/cypress-reporter (probaraNodeEvents)`.
