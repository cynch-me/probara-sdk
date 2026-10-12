/**
 * A user runner that throws when it loads fails its test file as it does without the reporter: the
 * reporter keeps the runner as it is, so the exit code is the same, and the error is the user's own.
 * Real Vitest, in each supported major, against a fake Probara.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf, type Entries } from './support/expected.js';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const ERROR = 'planted: the user runner broke on import';

/**
 * A runner that fails to load is an unhandled error of the run, not a result (V-D12): nothing is sent,
 * and the reporter says so once.
 */
const RESULTS: Entries = {};

describe.each(VITEST_VERSIONS)(
  '$name with the reporter, a user runner that throws when it loads',
  (vitest) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let withReporter: CommandRun;
    let withoutReporter: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      fake = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(vitest, 'broken-runner');
      withReporter = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
      withoutReporter = await workspace.vitest(['run', '--config', 'plain.config.mts']);
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    it('exits with the code of the run without the reporter, and reports the file as one failed result', () => {
      expect(withoutReporter.exitCode).not.toBe(0);
      expect(withReporter.exitCode).toBe(withoutReporter.exitCode);
      expect(entriesOf(fake.reports())).toEqual(RESULTS);
    });

    it('shows the error of the user runner, and the one warning of the reporter about it', () => {
      expect(withReporter.stdout + withReporter.stderr).toContain(ERROR);
      expect(withReporter.stdout + withReporter.stderr).toContain(
        'Vitest reported 1 unhandled error outside the tests',
      );
      expect(withReporter.stdout + withReporter.stderr).not.toContain(
        '[probara] Probara reporting is off',
      );
    });
  },
);
