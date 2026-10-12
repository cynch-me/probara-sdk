import { defineConfig } from 'vitest/config';

// The issue template as the reporter option: each probara.issue(id) becomes a link to its page.
export default defineConfig({
  test: {
    reporters: [
      'default',
      ['@probara/vitest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
    ],
  },
});
