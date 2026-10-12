import { defineConfig } from 'vitest/config';

// The same run without the reporter: the baseline the reporter's run must equal.
export default defineConfig({
  test: {
    runner: './runner.mjs',
    reporters: ['default'],
  },
});
