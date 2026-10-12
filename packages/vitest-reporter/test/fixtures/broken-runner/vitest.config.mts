import { defineConfig } from 'vitest/config';

// A user runner that throws when it loads: its file fails, with or without the reporter.
export default defineConfig({
  test: {
    runner: './runner.mjs',
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
