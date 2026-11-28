import { defineConfig } from 'tsdown';

// `dist/index.js` for `import` and `dist/index.cjs` for `require`, with their types. The private
// error core (`@probara/error-core`) is bundled in, its types too, so it is never a dependency.

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node20',
  tsconfig: 'tsconfig.build.json',
  // The error core's sources are compiled with the package's (eagerly: they live outside `src`).
  dts: { tsc: { eager: true } },
  outDir: 'dist',
  clean: true,
  deps: {
    alwaysBundle: ['@probara/error-core'],
  },
});
