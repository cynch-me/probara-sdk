---
'@probara/vite-plugin': minor
'@probara/webpack-plugin': minor
'@probara/esbuild-plugin': minor
'@probara/rollup-plugin': minor
'@probara/cli': patch
---

New `@probara/vite-plugin`, `@probara/webpack-plugin`, `@probara/esbuild-plugin` and `@probara/rollup-plugin`: after each build they give every emitted JavaScript file with a source map a debug ID and the release (`globalThis.PROBARA_RELEASE`), and upload those maps to Probara error monitoring for the release, with the same debug IDs and variables as `probara sourcemaps inject` and `upload` (`PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL`, plus `PROBARA_RELEASE`). Without a token, a project or a release they warn, still inject, and the build succeeds. `sourcemaps.filesToDeleteAfterUpload` deletes the maps after the upload; the Vite plugin turns hidden source maps on when `build.sourcemap` is not set, and deletes them after the upload. The CLI docs show the Angular CLI flow: `ng build`, then `probara sourcemaps inject` and `upload`.
