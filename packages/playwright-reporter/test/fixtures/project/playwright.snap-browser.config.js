// The project of the Probara Snap browser test: a real Chromium page, which only a machine with
// the browser installed runs (see test/snap-browser.test.ts).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './snap-browser',
  outputDir: process.env.FIXTURE_OUTPUT_DIR ?? 'test-results-snap-browser',
  workers: 1,
  use: { browserName: 'chromium', viewport: { width: 800, height: 600 }, colorScheme: 'dark' },
});
