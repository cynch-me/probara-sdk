// @ts-check
const { defineConfig } = require('@playwright/test');

// PW_JUNIT_OUTPUT_NAME lets generate.sh write several variants next to this source/ folder.
// Other junit reporter options are toggled with Playwright's own PLAYWRIGHT_JUNIT_* env vars.
const outputName = process.env.PW_JUNIT_OUTPUT_NAME || 'junit.xml';

module.exports = defineConfig({
  testDir: './tests',
  outputDir: '../test-results',
  retries: 1,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: `../${outputName}` }]],
  projects: [{ name: 'node' }],
});
