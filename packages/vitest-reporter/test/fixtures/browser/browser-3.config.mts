import { defineConfig } from 'vitest/config';

// Browser mode on Vitest 3: the provider is named by its string (V10).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
