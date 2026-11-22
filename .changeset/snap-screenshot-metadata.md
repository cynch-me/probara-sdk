---
'@probara/core': minor
'@probara/playwright-reporter': patch
'@probara/cypress-reporter': patch
'@probara/vitest-reporter': patch
'@probara/cli': patch
---

Probara Snap: every screenshot carries the metadata Probara shows beside it. `uploadSnapScreenshots`
sends the package that uploads (`sdk`, `@probara/core` unless the caller names its own), and a
screenshot may carry its browser version, the URL of its page (only an `http` or `https` URL), the
automation library and its version, and where its test is declared, its retries, annotations and
tags. Values the Snap API would refuse are left out, and the screenshot is still sent. The
Playwright reporter sends `@playwright/test` and its version, the browser version, the page's URL,
the test's line and column, its `retries`, annotations and tags; the Cypress reporter sends Cypress
and its version, the browser version, the page's URL and the test's `retries`; the Vitest reporter
sends Vitest and its version, the page's URL, the test's `retries`, annotations, tags and location;
`probara snap upload` names `@probara/cli`.
