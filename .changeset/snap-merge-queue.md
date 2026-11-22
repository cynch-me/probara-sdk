---
'@probara/core': minor
'@probara/playwright-reporter': patch
'@probara/vitest-reporter': patch
'@probara/cypress-reporter': patch
---

Probara Snap reads a GitHub Actions merge queue run (`merge_group`): the build keeps its queue branch
(`gh-readonly-queue/<base>/pr-<n>-<sha>`), and sends `<base>` as its base branch and `<n>` as its
pull request, so Probara compares it with its base branch like a pull request build.
