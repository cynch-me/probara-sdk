import { defineConfig } from 'vitest/config';

// A shard's config (V-D4): the blob reporter beside the reporter, so the setup file records the files of each
// attempt. Without a token the shard sends nothing; its copies stay in the attachments folder for the merge.
export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    reporters: ['blob', ['@probara/vitest-reporter', {}]],
  },
});
