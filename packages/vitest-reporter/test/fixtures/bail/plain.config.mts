import { defineConfig } from 'vitest/config';

// The same run without the reporter: its exit code is the one the reporter must keep.
export default defineConfig({
  test: {
    fileParallelism: false,
    reporters: ['default'],
  },
});
