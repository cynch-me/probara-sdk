/**
 * The real `vitest --watch`, in each supported major, against a fake Probara (V8, J-J3): a test file that changes
 * makes Vitest re-run it in the same process, and every re-run reports into the one run the first one created,
 * which stays open. A run closed or deleted in Probara meanwhile refuses the next re-run, and its results go into a
 * new run at once. The watcher needs no terminal: the test changes a file to start each re-run.
 */
import { appendFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type RunningCommand,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;
/** How long one re-run may take to report, in a busy CI job. */
const RERUN_TIMEOUT = 60_000;
/** A change the watcher did not start a re-run for is repeated after this long (Jest's watch test does the same). */
const NUDGE_MS = 10_000;
const CART = 'tests/cart.test.ts';
const FIRST = `${CART} > cart > adds an item`;

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

/**
 * Adds a test to the file, so the watcher re-runs it: the re-run reports every test of the file, and the report count
 * reaches `reports`. The watcher is given a moment to be ready first. A change the watcher does not start a re-run for
 * is repeated as a comment, so the file changes again until one does.
 */
async function rerun(
  workspace: Workspace,
  fake: FakeProbara,
  vitest: RunningCommand,
  added: number,
  reports: number,
): Promise<void> {
  const file = join(workspace.dir, CART);
  await delay(1_000);
  await appendFile(file, `\nit('added while watching ${String(added)}', () => {});\n`);
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

/** Stops Vitest, and waits until it exited. */
async function stop(vitest: RunningCommand): Promise<void> {
  vitest.child.kill('SIGTERM');
  await vitest.exited;
}

/** The automation keys of one report, in order. */
function keysOf(fake: FakeProbara, index: number): string[] {
  return fake.reports()[index]?.results.map((entry) => entry.automationKey ?? '') ?? [];
}

describe.each(VITEST_VERSIONS)('$name in watch mode, one run per session', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let watching: RunningCommand;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'watch');
    watching = workspace.startVitest(['--watch'], probaraEnv(fake.baseUrl));
    try {
      // The first run is report 1, and creates the run. Then two re-runs: each one reports, into the same run.
      await waitForOutput(watching, 'Waiting for file changes');
      await rerun(workspace, fake, watching, 2, 2);
      await rerun(workspace, fake, watching, 3, 3);
      // A change of the config restarts the server: the reporter is instantiated again, and the session goes on.
      await delay(1_000);
      await appendFile(join(workspace.dir, 'vitest.config.mts'), '\n// restarted while watching\n');
      await waitForReports(fake, 4, watching);
    } finally {
      await stop(watching);
    }
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('reports every re-run into the one run the first created, and never closes it', () => {
    const [run] = fake.runs();
    expect(fake.runs()).toHaveLength(1);
    expect(run?.state).toBe('open');
    const reports = fake.reports();
    expect(reports.length).toBeGreaterThanOrEqual(4);
    expect(reports.slice(1).map((report) => report.run)).toEqual(
      reports.slice(1).map(() => ({ ulid: run?.ulid })),
    );
    expect(reports.some((report) => report.options?.close === true)).toBe(false);
    expect(fake.requestsTo('closeRun')).toEqual([]);
  });

  it('sends the tests each re-run added, and keeps the earlier ones in later re-runs', () => {
    expect(keysOf(fake, 0)).not.toContain(`${CART} > added while watching 2`);
    expect(keysOf(fake, 1)).toContain(`${CART} > added while watching 2`);
    expect(keysOf(fake, 2)).toContain(`${CART} > added while watching 3`);
    expect(keysOf(fake, 2)).toContain(FIRST);
  });

  it('says once where every re-run reports, and how to close it', () => {
    const [run] = fake.runs();
    const output = watching.output();
    const watchLines = output.split('\n').filter((line) => line.includes('Watch mode'));
    expect(watchLines).toEqual([
      `[probara] Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid ${run?.ulid ?? ''}`,
    ]);
    expect(output).toMatch(/Recorded \d+ results .* in R-1 \(open\)/);
    expect(output).not.toContain(TOKEN);
  });

  it('keeps the run when the server restarts: the next report goes into the same run', () => {
    const [run] = fake.runs();
    expect(fake.runs()).toHaveLength(1);
    expect(fake.reports().at(-1)?.run).toEqual({ ulid: run?.ulid });
    expect(fake.requestsTo('closeRun')).toEqual([]);
  });
});

describe.each(VITEST_VERSIONS)('$name in watch mode, when Probara refuses the run', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let watching: RunningCommand;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'watch');
    watching = workspace.startVitest(['--watch'], probaraEnv(fake.baseUrl));
    try {
      await waitForOutput(watching, 'Waiting for file changes');
      // The first run is report 1: it creates the run that the next re-run is refused in, so wait for it first.
      await waitForReports(fake, 1, watching);
      // Closed in Probara: the next re-run is refused (report 2, 409), and its results go into a new run (report 3).
      const [first] = fake.runs();
      if (first === undefined) {
        throw new Error(`The first run created no run in Probara:\n${watching.output()}`);
      }
      first.state = 'closed';
      await rerun(workspace, fake, watching, 1, 3);
      // The run the next re-run goes into is deleted: refused (report 4, 404), and sent into a new run (report 5).
      fake.fail(
        'report',
        { status: 404, body: { error: { code: 'not_found', message: 'The run was not found' } } },
        { from: fake.requestsTo('report').length + 1, times: 1 },
      );
      await rerun(workspace, fake, watching, 2, 5);
      // The re-run after that reports into the run of report 5.
      await rerun(workspace, fake, watching, 3, 6);
    } finally {
      await stop(watching);
    }
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('sends the results of a refused re-run into a new run, and the next re-run reports into that run', () => {
    const runs = fake.runs();
    expect(runs).toHaveLength(3);
    const reports = fake.reports();
    expect(reports[1]?.run).toEqual({ ulid: runs[0]?.ulid });
    expect(keysOf(fake, 1)).toContain(`${CART} > added while watching 1`);
    expect(reports[2]?.run).not.toEqual({ ulid: runs[0]?.ulid });
    expect(keysOf(fake, 2)).toContain(`${CART} > added while watching 1`);
    expect(reports[3]?.run).toEqual({ ulid: runs[1]?.ulid });
    expect(keysOf(fake, 3)).toContain(`${CART} > added while watching 2`);
    expect(reports[4]?.run).not.toEqual({ ulid: runs[1]?.ulid });
    expect(keysOf(fake, 4)).toContain(`${CART} > added while watching 2`);
    expect(reports[5]?.run).toEqual({ ulid: runs[2]?.ulid });
    expect(keysOf(fake, 5)).toContain(`${CART} > added while watching 3`);
  });

  it('says which run refused the results, why, and how many results went into the new run', () => {
    const output = watching.output();
    expect(output).toContain(
      '[probara] The run R-1 of SHOP was closed: sent the 2 results of this re-run into a new run',
    );
    expect(output).toContain(
      '[probara] The run R-2 of SHOP was deleted: sent the 3 results of this re-run into a new run',
    );
  });
});

describe.each(VITEST_VERSIONS)('$name in watch mode, with a results file', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let watching: RunningCommand;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'watch');
    watching = workspace.startVitest(
      ['--watch', '--config', 'results-file.config.mts'],
      probaraEnv(fake.baseUrl),
    );
    try {
      await waitForOutput(watching, 'Waiting for file changes');
      const [first] = fake.runs();
      if (first !== undefined) first.state = 'closed';
      await rerun(workspace, fake, watching, 1, 2);
      await waitForOutput(watching, 'keeps this re-run');
    } finally {
      await stop(watching);
    }
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('keeps the refused re-run in the results file, and sends it into no new run', async () => {
    expect(fake.runs()).toHaveLength(1);
    const file = join(workspace.dir, 'results', 'rerun.json');
    await stat(file);
    const text = await readFile(file, 'utf8');
    // The file keeps each result's identity: the title path of the re-run's test, and the test before it.
    expect(text).toContain('"added while watching 1"');
    expect(text).toContain('"adds an item"');
  });
});
