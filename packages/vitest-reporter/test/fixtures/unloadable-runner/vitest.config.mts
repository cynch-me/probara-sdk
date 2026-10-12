import { defineConfig } from 'vitest/config';

// A user runner Node cannot import: the reporter keeps it as it is, and the run is the same as without
// the reporter (`plain.config.mts`).
export default defineConfig({
  test: {
    runner: './runner.jsx',
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
