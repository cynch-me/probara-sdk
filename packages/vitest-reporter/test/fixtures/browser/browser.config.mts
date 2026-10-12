import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Browser mode on Vitest 4 and 5: Playwright's Chromium, headless (V10).
export default defineConfig({
  server: { fs: { deny: ['**/refused/**'] } },
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
    // The project's own deny list: a browser attach of a file in it is refused, as Vite refuses it (V-D103).
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
