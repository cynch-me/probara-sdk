import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// A shard of the browser project that writes a blob: the reporter stands beside the blob reporter, and sends nothing.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['blob', ['@probara/vitest-reporter', {}]],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      viewport: { width: 414, height: 600 },
      instances: [{ browser: 'chromium' }],
    },
  },
});
