import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Unit tests import core from its source, so they never need core's build.
    alias: { '@probara/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The end-to-end tests run the real cucumber-js with the built formatter: build core, the CLI
    // and the formatter, once.
    globalSetup: ['test/support/global-setup.ts'],
  },
});
