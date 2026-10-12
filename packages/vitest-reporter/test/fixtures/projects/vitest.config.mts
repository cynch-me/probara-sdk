import { defineConfig } from 'vitest/config';

// Two Vitest projects: `tests/shop.test.ts` belongs to both, `tests/admin.test.ts` to `unit` only.
export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
    projects: [
      { test: { name: 'unit', include: ['tests/*.test.ts'] } },
      { test: { name: 'smoke', include: ['tests/shop.test.ts'] } },
    ],
  },
});
