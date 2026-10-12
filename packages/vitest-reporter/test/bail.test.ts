/**
 * An interrupted run, `vitest run --bail 1`, in each supported major, against a fake Probara (V8, V-D12): the tests
 * the run never got to are sent as skipped, with the note that says so, and a file it never started is counted in one
 * warning and sends nothing. The exit code is the one the run has without the reporter.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const PASSED = 'tests/alpha.test.ts > alpha > passes first';
const FAILED = 'tests/alpha.test.ts > alpha > fails';
const NEVER_REACHED = 'tests/alpha.test.ts > alpha > is never reached';
const NOT_RUN = 'Not run: the test run was interrupted';
const WARNING = 'Vitest did not run 1 test file of this run: nothing of it is reported';

describe.each(VITEST_VERSIONS)('$name with --bail 1', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;
  let plain: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'bail');
    const env = probaraEnv(fake.baseUrl);
    run = await workspace.vitest(['run', '--bail', '1'], env);
    plain = await workspace.vitest(['run', '--bail', '1', '--config', 'plain.config.mts'], env);
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  /** The result sent for one automation key, if any. */
  const resultOf = (key: string) =>
    fake
      .reports()
      .flatMap((report) => report.results)
      .find((result) => result.automationKey === key);

  it('sends the test that failed, and the tests after it as skipped with the note that the run was interrupted', () => {
    expect(resultOf(PASSED)?.status).toBe('passed');
    expect(resultOf(FAILED)?.status).toBe('failed');
    expect(resultOf(NEVER_REACHED)?.status).toBe('skipped');
    expect(resultOf(NEVER_REACHED)?.notes).toBe(NOT_RUN);
  });

  it('sends nothing for the file the run never started, and counts it in one warning', () => {
    const keys = fake
      .reports()
      .flatMap((report) => report.results.map((result) => result.automationKey));
    expect(keys.some((key) => key?.startsWith('tests/beta.test.ts'))).toBe(false);
    expect(run.stdout + run.stderr).toContain(`[probara] ${WARNING}`);
    expect(run.stdout + run.stderr).toContain(WARNING);
  });

  it('exits with the code the run has without the reporter', () => {
    expect(run.exitCode).toBe(1);
    expect(run.exitCode).toBe(plain.exitCode);
  });
});
