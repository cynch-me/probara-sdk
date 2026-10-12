import { defineConfig } from 'vitest/config';

// A user runner and a user setup file: the reporter must keep both, the runner wrapped.
export default defineConfig({
  test: {
    runner: './custom-runner.mjs',
    setupFiles: ['./user-setup.mts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
