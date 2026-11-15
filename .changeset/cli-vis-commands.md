---
'@probara/cli': minor
'@probara/core': minor
---

New `probara vis` commands: `list`, `get`, `create`, `update` and `delete`. `vis create <file>`
uploads a video (MP4 or WebM, in 8 MiB parts) or an image (PNG, JPEG or WebP) as a Vis, and
`--playwright-trace <trace.zip>` attaches the console, the network and the user actions of a
Playwright trace, with secrets redacted before anything is sent. The core client gains the Vis
endpoints these commands call. The Vis commands need a personal API token.
