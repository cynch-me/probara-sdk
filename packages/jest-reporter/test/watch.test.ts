/**
 * The real `jest --watchAll`, in each supported version, against a fake Probara: a test file that
 * changes makes Jest re-run it with a new reporter in the same process, and every re-run reports
 * into the one run the first created, which stays open. Jest reads keys only from a terminal, so
 * the test changes a file to start the re-run, then stops Jest.
 */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type RunningCommand,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
/** How long one run of Jest may take to report, in a busy CI job. */
const RUN_TIMEOUT = 60_000;
const RECORDED = /\[probara\] Recorded \d+ results/g;

/** How many runs of Jest reported so far. */
function reportedRuns(jest: RunningCommand): number {
  return jest.output().match(RECORDED)?.length ?? 0;
}

/**
 * Waits until `count` runs of Jest reported. Every `nudgeMs` without one, `nudge()` changes the test
 * file again: a watcher that was not ready yet missed the change before.
 */
async function waitForRuns(
  jest: RunningCommand,
  count: number,
  nudge?: () => Promise<void>,
  nudgeMs = 10_000,
): Promise<void> {
  const start = Date.now();
  let nudged = start;
  while (reportedRuns(jest) < count) {
    if (Date.now() - start > RUN_TIMEOUT) {
      throw new Error(`Jest reported ${String(reportedRuns(jest))} runs:\n${jest.output()}`);
    }
    if (nudge !== undefined && Date.now() - nudged > nudgeMs) {
      nudged = Date.now();
      await nudge();
    }
    await delay(100);
  }
}

describe.each(JEST_VERSIONS)('watch mode in $name', (jest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let watching: RunningCommand;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(jest);
    const cart = join(workspace.dir, 'tests', 'cart.test.js');
    let added = 0;
    const change = async () => {
      added += 1;
      await appendFile(cart, `\ntest('added while watching ${String(added)}', () => {});\n`);
    };
    watching = workspace.startJest(
      ['--watchAll', '--no-watchman', 'tests/cart.test.js'],
      probaraEnv(fake.baseUrl),
    );
    try {
      await waitForRuns(watching, 1);
      // Give the watcher a moment before the change it must see.
      await delay(1_000);
      await change();
      await waitForRuns(watching, 2, change);
    } finally {
      watching.child.kill('SIGTERM');
      await watching.exited;
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
    expect(reports.length).toBeGreaterThanOrEqual(2);
    expect(reports.slice(1).map((report) => report.run)).toEqual(
      reports.slice(1).map(() => ({ ulid: run?.ulid })),
    );
    expect(reports.some((report) => report.options?.close === true)).toBe(false);
    expect(fake.requestsTo('closeRun')).toEqual([]);
    const keys = reports.map((report) => report.results.map((entry) => entry.automationKey));
    expect(keys[0]).not.toContain('tests/cart.test.js > added while watching 1');
    expect(keys[1]).toContain('tests/cart.test.js > added while watching 1');
    expect(keys[1]).toContain('tests/cart.test.js > cart adds an item');
  });

  it('says once where every re-run reports, and how to close it', () => {
    const output = watching.output();
    const watchLines = output.split('\n').filter((line) => line.includes('Watch mode'));
    expect(watchLines).toEqual([
      `[probara] Watch mode: every re-run reports into R-1 of SHOP, which stays open: close it in Probara, or with probara run close --project SHOP --run-ulid ${fake.runs()[0]?.ulid ?? ''}`,
    ]);
    expect(output).toMatch(
      /Recorded \d+ results .* in R-1 \(open\)[^]*Recorded \d+ results .* in R-1 \(open\)/,
    );
    expect(output).not.toContain(TOKEN);
  });
});
