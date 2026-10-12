import { defineConfig } from 'vitest/config';

// The same shared tests on Node, as the parity baseline of the browser run (V10).
export default defineConfig({
  test: {
    include: ['tests/shared.test.ts'],
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
