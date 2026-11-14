import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

// Two projects: the pure logic runs on Node; what needs a real page (console patching, window
// `error` and `unhandledrejection`, DOM nodes) runs in Playwright's headless Chromium, as the
// Vitest reporter's browser tests do.
export default defineConfig({
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
