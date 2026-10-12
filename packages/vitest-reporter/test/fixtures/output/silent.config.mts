import { defineConfig } from 'vitest/config';

// `silent` keeps the default reporter from printing the console. The reporters still receive every log, so the
// output is attached all the same: `silent` decides what is printed, not what is reported.
export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    silent: true,
    reporters: ['default', ['@probara/vitest-reporter', { captureOutput: true }]],
  },
});
