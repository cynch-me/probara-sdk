import { defineConfig } from 'vitest/config';

// A shard's config (V-D4): the blob reporter beside the reporter, so the shard prepares the workers and sends nothing.
export default defineConfig({
  test: {
    reporters: ['blob', ['@probara/vitest-reporter', {}]],
  },
});
