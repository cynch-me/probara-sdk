import { defineConfig } from 'vitest/config';

// A shard's config (V-D4): the blob reporter beside the reporter, so the setup file and the runner of the
// helpers are registered and the metadata is recorded in the blob. A sharded run sends nothing itself.
export default defineConfig({
  test: {
    tags: [{ name: 'regression' }],
    reporters: [
      'blob',
      ['@probara/vitest-reporter', { issueUrlTemplate: 'https://jira.example.com/browse/%s' }],
    ],
  },
});
