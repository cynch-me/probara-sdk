import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The reporter with a results file: the results a re-run could not send are kept in it (J-J3).
export default defineConfig({
  test: {
    reporters: [
      'default',
      ['@probara/vitest-reporter', { resultsFile: fileURLToPath(new URL('./results/rerun.json', import.meta.url)) }],
    ],
  },
});
