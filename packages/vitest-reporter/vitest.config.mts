import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const CORE_SRC = new URL('../core/src/', import.meta.url);

export default defineConfig({
  resolve: {
    // Unit tests import core from its source, so they never need core's build. The subpath first:
    // an alias also rewrites the paths it prefixes.
    alias: [
      {
        find: /^@probara\/core\/metadata$/,
        replacement: fileURLToPath(new URL('metadata-entry.ts', CORE_SRC)),
      },
      { find: /^@probara\/core$/, replacement: fileURLToPath(new URL('index.ts', CORE_SRC)) },
    ],
  },
  test: {
    // The end-to-end tests run the real Vitest with the built reporter; each builds it first
    // (`test/support/reporter-build.ts`).
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The fixture projects are Vitest's own test files, run by the end-to-end tests, never here.
    exclude: [...configDefaults.exclude, 'test/fixtures/**'],
  },
});
