import { defineConfig } from 'tsdown';

// The builds:
// - `dist/index.js`, with its types: the ES module npm users import. The private error core
//   (`@probara/error-core`) is bundled in, its types too, so it is never a dependency. The capture
//   engine, `@probara/vis-capture`, stays a dependency, resolved by the user's bundler, so a page
//   that also runs Probara Vis shares one copy; its replay entry (`@probara/vis-capture/replay`)
//   is imported lazily, only when the replay is on;
// - `dist/probara.browser.min.js`: one self-contained minified file for a script tag, the engine
//   and the error core bundled in, which sets the global `Probara` and makes the calls the
//   README's loader queued. The replay entry stays out of it (an IIFE cannot split code): it loads
//   the engine's published replay script instead (`replay-script.ts`).

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    // The error core's sources are compiled with the package's (eagerly: they live outside `src`).
    dts: { tsc: { eager: true } },
    outDir: 'dist',
    clean: true,
    deps: {
      alwaysBundle: ['@probara/error-core'],
    },
  },
  {
    entry: { 'probara.browser.min': 'src/script.ts' },
    format: 'iife',
    globalName: 'Probara',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: false,
    minify: true,
    sourcemap: true,
    outDir: 'dist',
    clean: false,
    outputOptions: { entryFileNames: '[name].js' },
    deps: {
      alwaysBundle: ['@probara/error-core', '@probara/vis-capture'],
      // Never bundled: the script-tag build replaces the lazy import with the published script.
      neverBundle: ['@probara/vis-capture/replay'],
    },
  },
]);
