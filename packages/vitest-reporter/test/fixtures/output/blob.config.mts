import { defineConfig } from 'vitest/config';

// A shard's config: the blob reporter beside the reporter, so the output of each attempt is carried to the merge.
export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    reporters: ['blob', ['@probara/vitest-reporter', { captureOutput: true }]],
  },
});
