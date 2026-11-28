import { defineConfig } from 'tsdown';

// One build: `dist/index.js`, with its types. `@probara/browser`, Angular and RxJS stay imports,
// resolved by the app's bundler, so the app runs one copy of each.

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  clean: true,
});
