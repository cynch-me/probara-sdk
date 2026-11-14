---
'@probara/cli': minor
---

New `probara vis record --cdp <endpoint>`: attaches over the Chrome DevTools Protocol to a browser an
agent or a test runner drives, injects the capture engine of `@probara/vis-capture` into the page
(`--target` picks it among several) and into every document it navigates to, and records the DOM
replay with the console, the network requests and the user actions until a signal, `--duration`,
the page closing or 60 minutes. The recording becomes a Vis of kind `replay`, with its environment,
uploaded the way `vis create` uploads, with secrets redacted in the page and again before it is
sent; its length never exceeds the limit, and when the plan allows less the Vis keeps the recording
up to the plan limit. Nothing is created when nothing was captured.
