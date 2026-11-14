import { defineConfig } from 'tsdown';

// The builds, all for browsers:
// - `dist/index.js` and `dist/replay.js`, with their types: the ES modules npm users import.
//   `replay.js` is the `./replay` entry, the only one that imports rrweb, so a page that records
//   no replay never loads it; rrweb stays a dependency there, resolved by the user's bundler;
// - `dist/vis-capture.iife.js`: one minified file for a script tag, which sets the global
//   `ProbaraVisCapture`;
// - `dist/vis-capture-replay.iife.js`: the replay entry with rrweb bundled in, which sets the
//   global `ProbaraVisCaptureReplay`.
export default defineConfig([
  {
    entry: { index: 'src/index.ts', replay: 'src/replay.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: true,
    outDir: 'dist',
    clean: true,
  },
  {
    entry: { 'vis-capture': 'src/index.ts' },
    format: 'iife',
    globalName: 'ProbaraVisCapture',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: false,
    minify: true,
    sourcemap: true,
    outDir: 'dist',
    clean: false,
  },
  {
    entry: { 'vis-capture-replay': 'src/replay.ts' },
    format: 'iife',
    globalName: 'ProbaraVisCaptureReplay',
    platform: 'browser',
    target: 'es2022',
    tsconfig: 'tsconfig.build.json',
    dts: false,
    minify: true,
    sourcemap: true,
    outDir: 'dist',
    clean: false,
    deps: { alwaysBundle: ['rrweb'], onlyBundle: ['rrweb'] },
  },
]);
