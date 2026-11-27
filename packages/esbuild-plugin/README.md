# @probara/esbuild-plugin

The esbuild plugin of Probara error monitoring. After each build it gives every emitted JavaScript
file with a source map a debug ID and the release, and uploads those maps to the project, so the
errors `@probara/browser` and `@probara/node` send show their frames in the original source.

It does what `probara sourcemaps inject` and `probara sourcemaps upload` of
[`@probara/cli`](https://github.com/cynch-me/probara-sdk/blob/main/packages/cli/docs/commands.md#source-maps)
do, with the same debug IDs, the same token and the same variables.

## Install

```bash
npm install --save-dev @probara/esbuild-plugin
```

## Use

```js
import { build } from 'esbuild';
import { probaraEsbuildPlugin } from '@probara/esbuild-plugin';

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  outdir: 'dist',
  sourcemap: true,
  plugins: [probaraEsbuildPlugin()],
});
```

Set `sourcemap` to `true` or `'external'`, and an `outdir` or `outfile`. The plugin turns
`metafile` on to know the files esbuild wrote; with `write: false` there is no file, so it warns and
does nothing.

In CI, set `PROBARA_API_TOKEN`, `PROBARA_PROJECT` and `PROBARA_RELEASE`, and give the SDK the same
release:

```ts
import * as Probara from '@probara/browser';

Probara.init({ dsn: 'https://<public key>@<probara api host>/', release: 'shop@1.4.2' });
```

## What it does

- Each emitted `.js`, `.mjs` or `.cjs` file with a map gets a snippet that registers its debug ID at
  runtime, a `//# debugId=` comment, and `"debug_id"` in its map, whose mappings shift with the
  snippet. A file that already has a debug ID is left alone; the same file always gets the same one.
- The maps are then uploaded for the release, gzipped, four at a time, with retries on 429 and 5xx.
- Without a token, a project or a release, the plugin warns, still injects the debug IDs, and the
  build succeeds: nothing is uploaded. `PROBARA_ENABLED=false` turns the upload off too.
- A map Probara refuses fails the build, unless `errorHandler` takes the error.

## Options

| Option                                | Default                                            | What it does                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`                            | `PROBARA_API_TOKEN`                                | The API token the maps are uploaded with. Prefer the variable: a config file gets committed.                                                          |
| `project`                             | `PROBARA_PROJECT`                                  | The code of the project the maps belong to, such as `SHOP`.                                                                                           |
| `baseUrl`                             | `PROBARA_BASE_URL`, then `https://app.probara.net` | The Probara URL.                                                                                                                                      |
| `release.name`                        | `PROBARA_RELEASE`                                  | The release the maps are uploaded for: the one the SDK sends (its `release` option). Without one, nothing is uploaded.                                |
| `release.inject`                      | `true`                                             | Sets `globalThis.PROBARA_RELEASE = { id: <release> }` in every emitted file with a map. `false` leaves it out and still uploads for the release.      |
| `sourcemaps.disable`                  | `false`                                            | `true` only injects the debug IDs, and uploads nothing.                                                                                               |
| `sourcemaps.urlPrefix`                | `~/`                                               | What comes before the path of each file from the output directory in the URL it is served at; `~/` stands for any scheme and host.                    |
| `sourcemaps.filesToDeleteAfterUpload` | none                                               | Globs, from the current directory, of the files to delete once the upload step ends, uploaded or not, such as `dist/**/*.map`, so no map is deployed. |
| `disable`                             | `false`                                            | `true` turns the plugin off: the build output is left as it is.                                                                                       |
| `debug`                               | `false`                                            | Logs each uploaded map and each deleted file.                                                                                                         |
| `silent`                              | `false`                                            | Logs nothing.                                                                                                                                         |
| `errorHandler`                        | throws                                             | Gets the error of a file that could not be injected or a map that could not be uploaded. Without it, the build fails.                                 |

## License

Apache-2.0
