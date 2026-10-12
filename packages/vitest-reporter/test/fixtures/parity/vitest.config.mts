import { defineConfig } from 'vitest/config';

// The reporter as a user registers it, next to Vitest's default reporter. The JUnit runs of the
// parity test replace these reporters (`--reporter=junit`, or `junit-file.config.mts`).
export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
