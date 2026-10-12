import { defineConfig } from 'vitest/config';

// The same run without the reporter: every helper does nothing, and a step still runs its body.
// Vitest 4.1 and later reject a native tag the config does not declare.
export default defineConfig({
  test: {
    tags: [{ name: 'regression' }],
    reporters: ['default'],
  },
});
