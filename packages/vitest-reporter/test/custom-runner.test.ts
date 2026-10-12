/**
 * The reporter keeps a user's own runner and setup file: the runner is wrapped, not replaced, and the
 * setup file is kept, in order, with the reporter's first. Real Vitest, in each supported major.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf } from './support/expected.js';
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

describe.each(VITEST_VERSIONS)(
  '$name with the reporter, a user runner and setup file',
  (vitest) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let run: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      fake = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(vitest, 'custom-runner');
      run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    it('runs the test under the user runner and after the user setup file, and reports it as passed', () => {
      expect(run.exitCode).toBe(0);
      expect(entriesOf(fake.reports())).toEqual({
        'tests/runs-with-user-setup.test.ts > runs under the user runner, after the user setup file | -':
          ['passed'],
      });
    });
  },
);
