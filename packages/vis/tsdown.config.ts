import { defineConfig } from 'tsdown';

// The builds:
// - `dist/index.js`, with its types: the ES module npm users import. The capture engine,
//   `@probara/vis-capture`, stays a dependency, resolved by the user's bundler, and its replay
//   entry (`@probara/vis-capture/replay`) is imported lazily, so bundlers split rrweb into a chunk
//   only a widget with the instant replay loads;
// - `dist/reporter-token.js`, with its types: the reporter token helper for the customer's backend
//   (`@probara/vis/reporter-token`), Web Crypto only, so it runs on Node 20+, Deno and Workers;
// - `dist/vis.iife.js`: one self-contained minified file for a script tag, the engine bundled in,
//   which sets the global `ProbaraVis` and opens the recorder when the page's address carries a
//   recording link token. The replay entry stays out of it (an IIFE cannot split code): the
//   script-tag build loads the engine's published replay script instead (`replay-script.ts`).

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'reporter-token': 'src/reporter-token.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: true,
    outDir: 'dist',
    clean: true,
  },
  {
    entry: { vis: 'src/script.ts' },
    format: 'iife',
    globalName: 'ProbaraVis',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: false,
    minify: true,
    sourcemap: true,
    outDir: 'dist',
    clean: false,
    deps: {
      alwaysBundle: ['@probara/vis-capture'],
    },
    // Never bundled: the script-tag build replaces the lazy import with the published script.
    external: ['@probara/vis-capture/replay'],
  },
]);
