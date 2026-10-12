import { defineConfig } from 'vitest/config';

// The reporter as a user registers it, with no issue template: the issues of probara.issue() are dropped.
export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
