// The project the end-to-end tests run with the real `playwright test`. No test uses the `page`
// fixture, so no browser is needed. The tests pass the output folder and the reporters.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: process.env.FIXTURE_OUTPUT_DIR ?? 'test-results',
  retries: 1,
  workers: 1,
  use: { trace: 'on' },
  // Two named projects and an unnamed one (no `project` parameter in its keys).
  projects: [{ name: 'alpha' }, { name: 'beta' }, { testMatch: /cart\.spec\.js/ }],
});
