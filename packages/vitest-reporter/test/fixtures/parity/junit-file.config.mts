import { defineConfig } from 'vitest/config';

// Vitest's own JUnit output with the file on every testcase (`addFileAttribute`), for the parity test.
// `allowOnly`: the fixture has `.only` tests, which Vitest forbids when CI is set, unless allowed.
export default defineConfig({
  test: {
    allowOnly: true,
    reporters: [['junit', { addFileAttribute: true, outputFile: 'reports/junit-file.xml' }]],
  },
});
