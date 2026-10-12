import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Browser mode on Vitest 4 and 5: Playwright's Chromium, headless (V10).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
