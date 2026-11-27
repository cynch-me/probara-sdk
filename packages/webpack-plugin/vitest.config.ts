import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@probara\/bundler-plugin-core\/testing$/,
        replacement: source('../bundler-plugin-core/src/testing.ts'),
      },
      {
        find: /^@probara\/bundler-plugin-core$/,
        replacement: source('../bundler-plugin-core/src/index.ts'),
      },
      { find: /^@probara\/core$/, replacement: source('../core/src/index.ts') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
