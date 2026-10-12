import { defineConfig } from 'vitest/config';

// Browser mode on Vitest 3: the provider is named by its string (V10).
export default defineConfig({
  server: { fs: { deny: ['**/refused/**'] } },
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
    // The project's own deny list: a browser attach of a file in it is refused, as Vite refuses it (V-D103).
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
