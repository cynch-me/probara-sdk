---
'@probara/browser': minor
---

A script-tag build, `dist/probara.browser.min.js`, sets the global `Probara`, and the README
documents a loader snippet that queues calls, uncaught errors and unhandled rejections until the
script arrives. The replay loads only when it is on (from the engine's published replay script in
the script-tag build). On a page without Probara Vis, the shared capture keeps error-sized buffers
and no request or response bodies, and events list `npm:@probara/browser` in `sdk.packages`.
