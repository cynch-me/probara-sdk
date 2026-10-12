import { defineConfig } from 'vitest/config';

// Vitest's own JUnit output with the file on every testcase (`addFileAttribute`), for the parity test.
export default defineConfig({
  test: {
    reporters: [['junit', { addFileAttribute: true, outputFile: 'reports/junit-file.xml' }]],
  },
});
