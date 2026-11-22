import { defineConfig } from 'vitest/config';

// A Node project that calls probaraSnap: nothing is captured, and one warning says so.
export default defineConfig({
  test: {
    include: ['node/**/*.test.ts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
