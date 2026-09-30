// The project of the multi-project end-to-end tests: one unnamed project, no retries.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './projects',
  outputDir: process.env.FIXTURE_OUTPUT_DIR ?? 'test-results-projects',
  workers: 1,
});
