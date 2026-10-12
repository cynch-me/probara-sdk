import { defineConfig } from 'vitest/config';

// A reporter instance Probara cannot recognize: it may write a blob that a merge reads, so this run keeps its copies.
const silent = { onTestRunEnd() {} };

export default defineConfig({
  test: {
    attachmentsDir: 'attachments',
    reporters: [silent, ['@probara/vitest-reporter', {}]],
  },
});
