import { defineConfig } from 'vitest/config';

// Platform-neutral logic: everything runs on Node, with a fake transport and clock.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
