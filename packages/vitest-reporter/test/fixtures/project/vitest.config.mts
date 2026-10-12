import { defineConfig } from 'vitest/config';

// The reporter as a user registers it: by its package name, next to Vitest's default reporter.
export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
