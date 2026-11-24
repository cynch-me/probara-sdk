// The project of the Probara Snap end-to-end tests: one unnamed project, one retry, and tests that
// shards split one by one. No test uses the `page` fixture, so no browser is needed.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './snap',
  outputDir: process.env.FIXTURE_OUTPUT_DIR ?? 'test-results-snap',
  retries: 1,
  workers: 1,
  fullyParallel: true,
});
