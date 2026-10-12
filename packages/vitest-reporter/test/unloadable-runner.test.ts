/**
 * A user runner Node cannot import (a `.jsx` file, which Vite transforms) runs as it does without the
 * reporter: the reporter keeps it as it is, with one warning, and the run keeps its exit code and its
 * results. Real Vitest, in each supported major, against a fake Probara.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import { entriesOf, type Entries } from './support/expected.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;

/** What the fixture reports: the one test, passed, under its own runner. */
const RESULTS: Entries = {
  'tests/runs-under-jsx-runner.test.ts > runs under the user runner, which Node could not import | -':
    ['passed'],
};

describe.each(VITEST_VERSIONS)(
  '$name with the reporter, a user runner Node cannot import',
  (vitest) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let withReporter: CommandRun;
    let withoutReporter: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      fake = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(vitest, 'unloadable-runner');
      withReporter = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
      withoutReporter = await workspace.vitest(['run', '--config', 'plain.config.mts']);
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    it('runs the test under the user runner, with the exit code of the run without the reporter, and reports it as passed', () => {
      expect(withoutReporter.exitCode).toBe(0);
      expect(withReporter.exitCode).toBe(withoutReporter.exitCode);
      expect(entriesOf(fake.reports())).toEqual(RESULTS);
    });

    it('warns once, by name, that it keeps the runner as it is, and never fails the file with an error of its own', () => {
      const warning = 'which Node does not import: the reporter keeps it as it is';
      expect(withReporter.stderr.split(warning).length - 1).toBe(1);
      expect(withReporter.stdout + withReporter.stderr).not.toContain('Unknown file extension');
    });
  },
);
