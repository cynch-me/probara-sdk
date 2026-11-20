import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests import core and the Vis capture engine from their sources, so they never need a build.
    alias: {
      '@probara/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@probara/vis-capture': fileURLToPath(
        new URL('../vis-capture/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Fixture suites fail on purpose: they produce the JUnit reports the dialect tests read.
    exclude: [...configDefaults.exclude, 'test/fixtures/**'],
    // The smoke tests spawn the built bin: build core, then the CLI, once.
    globalSetup: ['test/support/global-setup.ts'],
    // A test that spawns the bin a few times takes about a second on a quiet machine, and several on
    // one running the other packages' end-to-end tests beside it (CI): a hang still fails.
    testTimeout: 30_000,
  },
});
