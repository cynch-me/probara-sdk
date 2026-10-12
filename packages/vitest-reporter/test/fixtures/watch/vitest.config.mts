import { defineConfig } from 'vitest/config';

// The reporter as a user registers it. Watch mode is `--watch` on the command line.
export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
