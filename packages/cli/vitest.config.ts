import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests import core from its source, so they never need core's build.
    alias: { '@probara/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Fixture suites fail on purpose: they produce the JUnit reports the dialect tests read.
    exclude: [...configDefaults.exclude, 'test/fixtures/**'],
    // The smoke tests spawn the built bin: build core, then the CLI, once.
    globalSetup: ['test/support/global-setup.ts'],
  },
});
