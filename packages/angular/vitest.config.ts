import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

// Two projects: the package checks run on Node; the Angular providers, the error handler and the
// interceptor run in Playwright's headless Chromium, on the real `@probara/browser`, read from its
// sources like what it builds on, so the tests never need their builds.

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@probara\/vis-capture\/replay$/,
        replacement: source('../vis-capture/src/replay.ts'),
      },
      { find: /^@probara\/vis-capture$/, replacement: source('../vis-capture/src/index.ts') },
      { find: /^@probara\/error-core$/, replacement: source('../error-core/src/index.ts') },
      { find: /^@probara\/browser$/, replacement: source('../browser/src/index.ts') },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.browser.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
