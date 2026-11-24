---
'@probara/core': patch
'@probara/playwright-reporter': patch
'@probara/cypress-reporter': patch
'@probara/vitest-reporter': patch
---

Probara Snap: each screenshot carries `test.captureIndex`, its position among the screenshots its
test took in the attempt that was sent, from 0. The build page orders the journey of a test by it.
