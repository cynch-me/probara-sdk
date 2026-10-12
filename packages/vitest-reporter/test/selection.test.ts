/**
 * `runCasesOnly` in real Vitest, in each supported major, against a fake Probara with a seeded run (V9, J-J4). Only the
 * tests of the run's cases run, which the bodies prove by what they wrote, and only they are reported. A run that
 * cannot be read, or none, runs and reports every test, with one warning. A watch session reads the run again at each
 * re-run, so a case added to the run selects its test from then on.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  startFakeProbara,
  type FakeProbara,
  type FakeRunCase,
} from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type RunningCommand,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;
/** How long one re-run may take to report, in a busy CI job. */
const RERUN_TIMEOUT = 60_000;
/** A change the watcher did not start a re-run for is repeated after this long (as in the watch test). */
const NUDGE_MS = 10_000;
const CHECKOUT = 'tests/checkout.test.ts';
const COUPON = `${CHECKOUT} > checkout > applies the coupon`;
const NOT_IN_RUN = `${CHECKOUT} > checkout > is not in the run`;
/** The cases of the seeded run: two by a case id in a test's names (`SHOP-1`, `SHOP-3`), one by an automation key. */
const CASES: FakeRunCase[] = [
  { caseDisplayId: 'SHOP-1', automationKey: null },
  { caseDisplayId: 'SHOP-2', automationKey: COUPON },
  { caseDisplayId: 'SHOP-3', automationKey: null },
];
/** The bodies of the run's cases, in the order they run: each one wrote its label to `ran.txt`. */
const SELECTED = ['SHOP-1 pays with a card', 'applies the coupon', 'issues the refund'];
/** Every body of the fixture, in the order the file runs them: the `checkout` describe, then `SHOP-3 refunds`. */
const EVERY = [
  'SHOP-1 pays with a card',
  'applies the coupon',
  'is not in the run',
  'SHOP-9 is not in the run',
  'issues the refund',
];
const NO_RUN_WARNING =
  'runCasesOnly needs the run whose tests to run: set run.ulid or PROBARA_RUN_ULID. Every test runs and is reported';

/** The labels the bodies wrote, in order: the bodies that ran. */
async function ranOf(workspace: Workspace): Promise<string[]> {
  const text = await readFile(join(workspace.dir, 'ran.txt'), 'utf8').catch(() => '');
  return text.split('\n').filter((line) => line !== '');
}

/** What Vitest printed, on either stream. */
function outputOf(command: CommandRun): string {
  return `${command.stdout}${command.stderr}`;
}

/** The results the fake received, in the order they were sent. */
function resultsOf(fake: FakeProbara) {
  return fake.reports().flatMap((report) => report.results);
}

/** Waits until the fake holds `count` report requests; fails with what Vitest printed, if it never does. */
async function waitForReports(
  fake: FakeProbara,
  count: number,
  vitest: RunningCommand,
): Promise<void> {
  const start = Date.now();
  while (fake.reports().length < count) {
    if (Date.now() - start > RERUN_TIMEOUT) {
      throw new Error(
        `Vitest sent ${String(fake.reports().length)} reports of ${String(count)}:\n${vitest.output()}`,
      );
    }
    await delay(100);
  }
}

/** Waits until Vitest printed `text`, or fails with what it printed. */
async function waitForOutput(vitest: RunningCommand, text: string): Promise<void> {
  const start = Date.now();
  while (!vitest.output().includes(text)) {
    if (Date.now() - start > RERUN_TIMEOUT) {
      throw new Error(`Vitest did not print "${text}":\n${vitest.output()}`);
    }
    await delay(100);
  }
}

/** Changes the test file so the watcher re-runs it, and waits until the fake holds `reports` reports. */
async function rerun(
  workspace: Workspace,
  fake: FakeProbara,
  vitest: RunningCommand,
  reports: number,
): Promise<void> {
  const file = join(workspace.dir, CHECKOUT);
  await delay(1_000);
  await appendFile(file, '\n// re-run\n');
  const start = Date.now();
  let nudged = start;
  while (fake.reports().length < reports) {
    if (Date.now() - start > RERUN_TIMEOUT) {
      throw new Error(
        `Vitest sent ${String(fake.reports().length)} reports of ${String(reports)}:\n${vitest.output()}`,
      );
    }
    if (Date.now() - nudged > NUDGE_MS) {
      nudged = Date.now();
      await appendFile(file, '// nudge\n');
    }
    await delay(100);
  }
}

describe.each(VITEST_VERSIONS)('$name with runCasesOnly and a seeded run', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;
  let ulid: string;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    ulid = fake.seedRun({ projectId: 'SHOP', cases: CASES });
    workspace = await createWorkspace(vitest, 'selection');
    run = await workspace.vitest(
      ['run'],
      probaraEnv(fake.baseUrl, { PROBARA_RUN_CASES_ONLY: 'true', PROBARA_RUN_ULID: ulid }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('runs only the bodies of the run cases: a case id in a title or a describe, or an automation key', async () => {
    expect(run.exitCode).toBe(0);
    expect(await ranOf(workspace)).toEqual(SELECTED);
  });

  it('reports only the tests of the run, and says how many matched and how many were skipped', () => {
    const results = resultsOf(fake);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.automationKey)).toContain(COUPON);
    expect(results.map((result) => result.automationKey)).not.toContain(NOT_IN_RUN);
    expect(outputOf(run)).toContain(
      `[probara] Ran only the tests of run ${ulid}: 3 of 5 tests match its cases; 2 skipped and not reported`,
    );
  });
});

describe.each(VITEST_VERSIONS)(
  '$name with runCasesOnly and no run to take the cases from',
  (vitest) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let run: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      fake = await startFakeProbara({ token: TOKEN });
      workspace = await createWorkspace(vitest, 'selection');
      run = await workspace.vitest(
        ['run'],
        probaraEnv(fake.baseUrl, { PROBARA_RUN_CASES_ONLY: 'true' }),
      );
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    it('runs and reports every test, with one warning that names the missing run', async () => {
      expect(run.exitCode).toBe(0);
      expect(await ranOf(workspace)).toEqual(EVERY);
      expect(resultsOf(fake)).toHaveLength(5);
      expect(outputOf(run)).toContain(`[probara] ${NO_RUN_WARNING}`);
    });
  },
);

describe.each(VITEST_VERSIONS)(
  '$name with runCasesOnly and cases that cannot be read',
  (vitest) => {
    let fake: FakeProbara;
    let workspace: Workspace;
    let run: CommandRun;
    let ulid: string;

    beforeAll(async () => {
      await buildReporter();
      fake = await startFakeProbara({ token: TOKEN });
      ulid = fake.seedRun({ projectId: 'SHOP', cases: CASES });
      fake.fail('caseKeys', {
        status: 404,
        body: { error: { code: 'not_found', message: 'The run was not found' } },
      });
      workspace = await createWorkspace(vitest, 'selection');
      run = await workspace.vitest(
        ['run'],
        probaraEnv(fake.baseUrl, { PROBARA_RUN_CASES_ONLY: 'true', PROBARA_RUN_ULID: ulid }),
      );
    }, TIMEOUT);

    afterAll(async () => {
      await fake.close();
      await workspace.remove();
    });

    it('runs and reports every test, with one warning that says the cases could not be read', async () => {
      expect(run.exitCode).toBe(0);
      expect(await ranOf(workspace)).toEqual(EVERY);
      expect(resultsOf(fake)).toHaveLength(5);
      expect(outputOf(run)).toContain(
        `[probara] runCasesOnly: could not read the cases of the run ${ulid} (`,
      );
    });
  },
);

describe.each(VITEST_VERSIONS)('$name in watch mode, with runCasesOnly', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let watching: RunningCommand;
  let ulid: string;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    ulid = fake.seedRun({ projectId: 'SHOP', cases: CASES });
    workspace = await createWorkspace(vitest, 'selection');
    watching = workspace.startVitest(
      ['--watch'],
      probaraEnv(fake.baseUrl, { PROBARA_RUN_CASES_ONLY: 'true', PROBARA_RUN_ULID: ulid }),
    );
    try {
      await waitForOutput(watching, 'Waiting for file changes');
      await waitForReports(fake, 1, watching);
      // A case added to the run selects the test it names: the next re-run reads the run again, runs that body, and reports it.
      const seeded = fake.run(ulid);
      if (seeded === undefined) throw new Error(`The fake holds no run ${ulid}`);
      seeded.cases.push({ caseDisplayId: 'SHOP-9', automationKey: null });
      await rerun(workspace, fake, watching, 2);
    } finally {
      watching.child.kill('SIGTERM');
      await watching.exited;
    }
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('reads the run again at each re-run: the case added to it runs and is reported at the next one', async () => {
    const ran = await ranOf(workspace);
    expect(ran.filter((label) => label === 'SHOP-9 is not in the run')).toHaveLength(1);
    expect(fake.reports().map((report) => report.results.length)).toEqual([3, 4]);
  });
});
