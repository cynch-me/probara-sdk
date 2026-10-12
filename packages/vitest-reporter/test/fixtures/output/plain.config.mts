import { defineConfig } from 'vitest/config';

// The reporter without `captureOutput`: off by default, so nothing of the console is attached.
export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
