import { defineConfig } from 'vitest/config';

// A shard that only writes its blob: the reporter is not registered, so the blob carries no attempts.
export default defineConfig({
  test: {
    reporters: ['blob'],
  },
});
