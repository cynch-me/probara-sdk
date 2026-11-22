---
'@probara/core': minor
'@probara/playwright-reporter': patch
'@probara/vitest-reporter': patch
'@probara/cypress-reporter': patch
---

Probara Snap: a build sends the commits Probara picks its baseline among (`parentCommits`): the
merge base of the commit and the base branch of its pull request, then its ancestors, at most 300,
or the commit and its ancestors on a push. They are read from the git checkout, and a shallow clone
is deepened from `origin`, so the CI needs no `fetch-depth: 0`. Without git or its history the
build is still sent, without them. `uploadSnapScreenshots` takes the checkout as `cwd`.
