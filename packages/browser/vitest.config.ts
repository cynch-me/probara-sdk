import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

// Two projects: the logic runs on Node; what needs a real page (the window's errors, the console,
// fetch, the replay) runs in Playwright's headless Chromium. Tests read the capture engine and the
// error core from their sources, so they never need their builds.

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Exact matches: the replay entry is not a path under the main one.
    alias: [
      {
        find: /^@probara\/vis-capture\/replay$/,
        replacement: source('../vis-capture/src/replay.ts'),
      },
      { find: /^@probara\/vis-capture$/, replacement: source('../vis-capture/src/index.ts') },
      { find: /^@probara\/error-core$/, replacement: source('../error-core/src/index.ts') },
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
            // A failed assertion is enough; no screenshot files are left in the package.
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
