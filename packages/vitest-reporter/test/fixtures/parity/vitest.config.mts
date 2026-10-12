import { defineConfig } from 'vitest/config';

// The reporter as a user registers it, next to Vitest's default reporter. The JUnit runs of the
// parity test replace these reporters (`--reporter=junit`, or `junit-file.config.mts`).
// `allowOnly`: the fixture has `.only` tests, which Vitest forbids when CI is set, unless allowed.
export default defineConfig({
  test: {
    allowOnly: true,
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
