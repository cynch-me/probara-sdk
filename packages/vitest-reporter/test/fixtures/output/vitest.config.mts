import { defineConfig } from 'vitest/config';

// The reporter with `captureOutput`: what each attempt writes to the console is attached as stdout.log and stderr.log.
export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    reporters: ['default', ['@probara/vitest-reporter', { captureOutput: true }]],
  },
});
