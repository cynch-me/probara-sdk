import { defineConfig } from 'vitest/config';

// The members the failed results are assigned to, as the reporter option.
export default defineConfig({
  test: {
    reporters: [
      'default',
      [
        '@probara/vitest-reporter',
        { assignFailedTo: ['ana@example.com', 'nobody@example.com', 'bo@example.com'] },
      ],
    ],
  },
});
