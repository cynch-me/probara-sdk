---
'@probara/cypress-reporter': minor
---

Probara Snap: `cy.probaraSnap(name, options?)`, added by the support file, takes a screenshot for
visual comparison. It waits for the fonts, stops animations, hides the caret and applies the masking
(`mask`, `hide`, `remove`, and the `data-probara-snap-mask` and `data-probara-snap-hide`
attributes) before Cypress captures the page. The plugin uploads the screenshots at the end of
`cypress run` as one build of the commit, named with `snapBuildName` (`PROBARA_SNAP_BUILD_NAME`).
When the specs are split across machines (`--parallel`, or `--spec` per machine), `snap: true`
(`PROBARA_SNAP`) on every machine makes them join one build by the nonce they share (`snapNonce`,
`PROBARA_SNAP_NONCE`, else what the CI gives), and `probara snap finalize` of `@probara/cli`
completes it in a final job.
