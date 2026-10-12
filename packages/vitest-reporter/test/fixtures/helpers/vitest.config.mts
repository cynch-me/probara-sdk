import { defineConfig } from 'vitest/config';

// The reporter as a user registers it, with the issue link template `probara.issue()` needs.
// Vitest 4.1 and later reject a native tag the config does not declare.
export default defineConfig({
  test: {
    tags: [{ name: 'regression' }],
    reporters: [
      'default',
      ['@probara/vitest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
    ],
  },
});
