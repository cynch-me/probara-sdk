# @probara/vite-plugin

## 0.1.0

### Minor Changes

- [#39](https://github.com/cynch-me/probara-sdk/pull/39) [`f1c518b`](https://github.com/cynch-me/probara-sdk/commit/f1c518b4fad8ee15d03881933bb04bffdd9744f5) Thanks [@GustavoCynch](https://github.com/GustavoCynch)! - New `@probara/vite-plugin`, `@probara/webpack-plugin`, `@probara/esbuild-plugin` and `@probara/rollup-plugin`: after each build they give every emitted JavaScript file with a source map a debug ID and the release (`globalThis.PROBARA_RELEASE`), and upload those maps to Probara error monitoring for the release, with the same debug IDs and variables as `probara sourcemaps inject` and `upload` (`PROBARA_API_TOKEN`, `PROBARA_PROJECT`, `PROBARA_BASE_URL`, plus `PROBARA_RELEASE`). Without a token, a project or a release they warn, still inject, and the build succeeds. `sourcemaps.filesToDeleteAfterUpload` deletes the maps after the upload; the Vite plugin turns hidden source maps on when `build.sourcemap` is not set, and deletes them after the upload. The CLI docs show the Angular CLI flow: `ng build`, then `probara sourcemaps inject` and `upload`.
