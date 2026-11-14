import { defineConfig } from 'tsdown';

// Two builds of `src/index.ts`, both for browsers:
// - `dist/index.js` and `dist/index.d.ts`: the ES module npm users import;
// - `dist/vis-capture.iife.js`: one minified file for a script tag, which sets the global
//   `ProbaraVisCapture`.
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
]);
