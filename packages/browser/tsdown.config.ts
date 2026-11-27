import { defineConfig } from 'tsdown';

// One build: `dist/index.js`, with its types, the ES module npm users import. The private error
// core (`@probara/error-core`) is bundled in, its types too, so it is never a dependency. The
// capture engine, `@probara/vis-capture`, stays a dependency, resolved by the user's bundler, so a
// page that also runs Probara Vis shares one copy; its replay entry
// (`@probara/vis-capture/replay`) is imported lazily, only when the replay is on.

export default defineConfig({
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
});
