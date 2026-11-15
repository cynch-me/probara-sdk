import { defineConfig } from 'tsdown';

// The builds, both for browsers:
// - `dist/index.js`, with its types: the ES module npm users import. The capture engine,
//   `@probara/vis-capture`, stays a dependency, resolved by the user's bundler;
// - `dist/vis.iife.js`: one self-contained minified file for a script tag, the engine bundled in,
//   which sets the global `ProbaraVis` and opens the recorder when the page's address carries a
//   recording link token.

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
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
  },
]);
