// The configuration CI merges each package's blob report with, to send its results to Probara
// (the PSDK project). The tests themselves run without the token: only this merge, after them,
// holds it. Automation keys start at the repository root, so two packages' test files never share
// a key. Run from a package directory: `vitest --merge-reports .vitest/blob --config ../../vitest.probara.js`.
import { URL, fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url));

export default {
  test: {
    reporters: [
      'default',
      [
        fileURLToPath(new URL('packages/vitest-reporter/dist/index.js', import.meta.url)),
        { projectId: 'PSDK', rootDir: repositoryRoot },
      ],
    ],
  },
};
