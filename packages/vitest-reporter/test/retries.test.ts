/**
 * Every execution of a retried or repeated test is a result of its own: each earlier attempt with its
 * own status, errors and duration, the `attempt` and `repeat` parameters, and the last execution with
 * its own outcome. Real Vitest, in each supported major, against a fake Probara.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATTEMPTS_RUN, ATTEMPT_PARAMETERS, entriesOf } from './support/expected.js';
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

describe.each(VITEST_VERSIONS)('$name with the reporter, on the attempts fixture', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'attempts');
    run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  /** The results sent for one key and case, in the order they were sent. */
  const resultsOf = (label: string) =>
    fake
      .reports()
      .flatMap((report) => report.results)
      .filter(
        (result) => `${result.automationKey ?? '?'} | ${result.caseDisplayId ?? '-'}` === label,
      );

  it('sends every execution of each test as a result, in the order it ran; the run stays red', () => {
    expect(run.exitCode).toBe(1);
    expect(entriesOf(fake.reports())).toEqual(ATTEMPTS_RUN);
  });

  it('tells the executions apart by their parameters, and keeps them out of the key', () => {
    for (const [label, parameters] of Object.entries(ATTEMPT_PARAMETERS)) {
      expect(resultsOf(label).map((result) => result.parameters ?? {})).toEqual(parameters);
    }
  });

  it('gives each failed attempt the errors of its own execution, and a passing one none', () => {
    const notesOf = (label: string) => resultsOf(label).map((result) => result.notes ?? '');
    const [first, second] = notesOf('tests/attempts.test.ts > passes on its second attempt | -');
    expect(first).toContain('passes on its second attempt: call 1 fails');
    expect(second).toBe('');

    const every = notesOf('tests/attempts.test.ts > fails on every attempt | -');
    expect(every).toHaveLength(3);
    expect(every[0]).toContain('call 1 fails');
    expect(every[1]).toContain('call 2 fails');
    expect(every[2]).toContain('call 3 fails');
    expect(every[2]).not.toContain('call 1 fails');

    const repeated = notesOf('tests/attempts.test.ts > repeats, and retries each repeat | -');
    expect(repeated[0]).toContain('call 1 fails');
    expect(repeated[1]).toBe('');
    expect(repeated[2]).toContain('call 3 fails');
    expect(repeated[3]).toBe('');
    expect(repeated[4]).toContain('call 5 fails');
    expect(repeated[5]).toBe('');
  });

  it('keeps the errors of concurrent tests with their own test, and the outcome of a test that passes first', () => {
    const [failed, passed] = resultsOf(
      'tests/attempts.test.ts > concurrent passes on its second attempt | -',
    ).map((result) => result.notes ?? '');
    expect(failed).toContain('concurrent passes on its second attempt: call 1 fails');
    expect(passed).toBe('');
    const [alone] = resultsOf('tests/attempts.test.ts > concurrent passes first | -');
    expect(alone?.notes ?? '').toBe('');
  });

  it('sends a test that passes under test.fails as failed, with the error Vitest gives it', () => {
    const [known] = resultsOf('tests/attempts.test.ts > is a known bug kept failing | -');
    expect(known?.status).toBe('failed');
    expect(known?.notes).toContain('Expect test to fail');
  });

  it('sends when each execution started and how long it took', () => {
    const all = fake.reports().flatMap((report) => report.results);
    expect(all.every((result) => typeof result.durationMs === 'number')).toBe(true);
    expect(all.every((result) => Number.isFinite(Date.parse(result.executedAt ?? '')))).toBe(true);
  });
});
