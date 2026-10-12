// The project the docs examples run in, as a user would lay it out: an example that brings no config runs with this
// one, and an example that brings no tests runs these.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default', '@probara/vitest-reporter'],
  },
});
