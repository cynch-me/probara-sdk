import { defineConfig } from 'vitest/config';

// The merging run's config: `vitest --merge-reports` reads it, and a run without shards reports from it.
export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
