import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node22',
  tsconfig: 'tsconfig.build.json',
  dts: { tsc: { eager: true } },
  outDir: 'dist',
  clean: true,
  deps: {
    alwaysBundle: ['@probara/bundler-plugin-core'],
  },
});
