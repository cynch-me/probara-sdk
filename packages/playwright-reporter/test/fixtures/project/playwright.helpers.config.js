// The project of the `probara.*` end-to-end tests: one named project, one retry.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './helpers',
  outputDir: process.env.FIXTURE_OUTPUT_DIR ?? 'test-results-helpers',
  retries: 1,
  workers: 1,
  projects: [{ name: 'alpha' }],
});
