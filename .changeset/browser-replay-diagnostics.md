---
'@probara/browser': patch
---

The replay uploaded with an event now carries the console, the network requests (without their
bodies) and the user events of the same window, as custom replay events tagged `probara.console`,
`probara.network` and `probara.events` whose payload is the entry Probara Vis uploads, so the
error replay shows them in step with the page. Entries older than the replay are left out.
