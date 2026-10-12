import { defineConfig } from 'vitest/config';

// The reporter as a user registers it: by its package name, next to Vitest's default reporter.
// `allowOnly`: the fixture has `.only` tests, which Vitest forbids when CI is set, unless allowed.
export default defineConfig({
  test: {
    allowOnly: true,
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
