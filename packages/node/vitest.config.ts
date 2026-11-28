import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests read the error core from its sources, so they never need its build.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@probara\/error-core$/,
        replacement: fileURLToPath(new URL('../error-core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
