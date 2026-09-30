/**
 * `assignFailedTo` in the real `jest`, in each supported version, against a fake Probara with
 * members: the reporter option and `PROBARA_ASSIGN_FAILED_TO` send the emails with the report, the
 * failed results are assigned (the passed ones never), and Probara's warning about emails that
 * match no member is logged as `Probara warned: …`.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const MEMBERS = ['ana@example.com', 'bo@example.com'];
const FAILED_KEY = 'tests/links.test.js > checkout fails and names its issue';

/** The lines of `run` that relay a warning of Probara. */
function probaraWarnings(run: CommandRun): string[] {
  return run.stderr.split('\n').filter((line) => line.includes('Probara warned'));
}

describe.each(JEST_VERSIONS)('assignFailedTo in $name', (jest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  const runs: Record<'option' | 'variable', CommandRun> = {} as never;

  async function fake(): Promise<FakeProbara> {
    const started = await startFakeProbara({ token: TOKEN, members: MEMBERS });
    fakes.push(started);
    return started;
  }

  beforeAll(async () => {
    workspace = await createWorkspace(jest, 'links');
    runs.option = await workspace.jest(
      ['--config', 'assign.config.js'],
      probaraEnv((await fake()).baseUrl),
    );
    runs.variable = await workspace.jest(
      [],
      probaraEnv((await fake()).baseUrl, { PROBARA_ASSIGN_FAILED_TO: ' Bo@example.com ' }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((each) => each.close()));
    await workspace.remove();
  });

  it('assigns the failed results to the members of the option, and relays the warning', () => {
    const [probara] = fakes as [FakeProbara];
    expect(runs.option.exitCode).toBe(1);
    expect(probara.reports().map((report) => report.options?.assignFailedTo)).toEqual([
      ['ana@example.com', 'nobody@example.com', 'bo@example.com'],
    ]);
    expect(probara.assignments()).toEqual([
      { runUlid: probara.runs()[0]?.ulid, automationKey: FAILED_KEY, email: 'ana@example.com' },
    ]);
    expect(probaraWarnings(runs.option)).toEqual([
      '[probara] Probara warned: assignFailedTo: 1 of 3 emails did not match a member who can be assigned in this project',
    ]);
    expect(runs.option.stdout + runs.option.stderr).not.toContain(TOKEN);
  });

  it('reads the emails from PROBARA_ASSIGN_FAILED_TO', () => {
    const [, probara] = fakes as [FakeProbara, FakeProbara];
    expect(probara.reports().map((report) => report.options?.assignFailedTo)).toEqual([
      ['Bo@example.com'],
    ]);
    expect(probara.assignments()).toEqual([
      { runUlid: probara.runs()[0]?.ulid, automationKey: FAILED_KEY, email: 'bo@example.com' },
    ]);
    expect(probaraWarnings(runs.variable)).toEqual([]);
  });
});
