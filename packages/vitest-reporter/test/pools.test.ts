/**
 * The executions of a retried or repeated test are the same whichever pool runs the test files: the
 * setup file and the runner extension reach the workers of the threads pool and of the forks pool.
 * Real Vitest, in each supported major, against a fake Probara.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATTEMPTS_RUN, entriesOf } from './support/expected.js';
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
const POOLS = ['threads', 'forks'] as const;

describe.each(VITEST_VERSIONS)('$name with the reporter, on the attempts fixture', (vitest) => {
  describe.each(POOLS)('on the %s pool', (pool) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let run: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      fake = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(vitest, 'attempts');
      run = await workspace.vitest(['run', `--pool=${pool}`], probaraEnv(fake.baseUrl));
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    it('sends the same executions as the default pool, and the same exit code', () => {
      expect(run.exitCode).toBe(1);
      expect(entriesOf(fake.reports())).toEqual(ATTEMPTS_RUN);
    });
  });
});
