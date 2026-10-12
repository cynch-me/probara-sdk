import { defineConfig } from 'vitest/config';

// One file at a time, so `--bail 1` stops the run before the second file starts.
export default defineConfig({
  test: {
    fileParallelism: false,
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
