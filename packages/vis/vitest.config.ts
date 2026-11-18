import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

// Two projects, as in the capture engine: the logic runs on Node with fakes of the browser; what
// needs a real page (the overlay, blur, the metadata handshake, the captures) runs in Playwright's
// headless Chromium. Tests read the engine from its sources, so they never need its build.
export default defineConfig({
  resolve: {
    // Exact matches: the replay entry is not a path under the main one.
    alias: [
      {
        find: /^@probara\/vis-capture\/replay$/,
        replacement: fileURLToPath(new URL('../vis-capture/src/replay.ts', import.meta.url)),
      },
      {
        find: /^@probara\/vis-capture$/,
        replacement: fileURLToPath(new URL('../vis-capture/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
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
