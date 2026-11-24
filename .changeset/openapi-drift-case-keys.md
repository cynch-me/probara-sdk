---
'@probara/core': patch
'@probara/cli': patch
---

Follow the published API again. `listRunCaseKeys` reads the parameters of a case as the server
lists them, by name and value, and still answers them as a record (`{ browser: 'chromium' }`):
they were dropped before. The CLI docs no longer list the `case_archived` reason: a result that
matches an archived case restores the case and is recorded.
