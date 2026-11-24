import { defineConfig } from 'vitest/config';

// Probara Snap in browser mode: Playwright's Chromium, headless, a fixed viewport.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      viewport: { width: 414, height: 600 },
      instances: [{ browser: 'chromium' }],
    },
  },
});
