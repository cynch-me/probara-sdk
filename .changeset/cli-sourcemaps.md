---
'@probara/cli': minor
---

`probara sourcemaps inject` gives built JavaScript files and their source maps a debug ID: a snippet that registers it at runtime, a `//# debugId=` comment and `"debug_id"` in the map, whose mappings shift with the snippet. Running it again changes nothing. `probara sourcemaps upload` sends the maps with a debug ID to the error monitoring of a project for a release, gzipped, with retries on 429 and 5xx; both take `--dry-run`.
