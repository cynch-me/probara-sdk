import { defineConfig } from 'vitest/config';

// The reporter as a user registers it, next to a setup file of the user's: the reporter keeps it.
export default defineConfig({
  test: {
    setupFiles: ['./user-setup.mts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
