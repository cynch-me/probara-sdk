// The project of the step end-to-end tests: one named project, no retries, and tests that
// shards split one by one.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './steps',
  outputDir: process.env.FIXTURE_OUTPUT_DIR ?? 'test-results-steps',
  workers: 1,
  fullyParallel: true,
  projects: [{ name: 'alpha' }],
});
