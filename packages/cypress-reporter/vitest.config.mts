import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
      {
        find: /^@probara\/core\/browser$/,
        replacement: fileURLToPath(new URL('browser.ts', CORE_SRC)),
      },
      { find: /^@probara\/core$/, replacement: fileURLToPath(new URL('index.ts', CORE_SRC)) },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The end-to-end tests run the real `cypress` with the built reporter: build core, the CLI and the
    // reporter, once.
    globalSetup: ['test/support/global-setup.ts'],
    // Test files run at the same time, and the plugin's session directory is named after the
    // parent pid they all share: each file gets a temporary directory of its own.
    setupFiles: ['test/support/own-tmpdir.ts'],
  },
});
