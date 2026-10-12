import { defineConfig } from 'vitest/config';

// The reporter as a user registers it. The attachments folder has a fixed name, so a shard's copies can be
// carried to the merge (V-D66), and a run without them can be tried.
export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
