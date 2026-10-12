import { defineConfig } from 'vitest/config';

// The reporter as a user registers it. The run's cases come from the environment: PROBARA_RUN_CASES_ONLY and PROBARA_RUN_ULID.
export default defineConfig({
  test: {
    reporters: ['default', ['@probara/vitest-reporter', {}]],
  },
});
