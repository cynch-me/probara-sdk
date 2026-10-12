import { defineConfig } from 'vitest/config';

// `onConsoleLog` returning false keeps the default reporter from printing a log; the reporters still receive it.
export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    onConsoleLog: () => false,
    reporters: ['default', ['@probara/vitest-reporter', { captureOutput: true }]],
  },
});
