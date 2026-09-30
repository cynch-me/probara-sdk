/**
 * Jest `projects` in the real `jest`, in each supported version: two projects, one of them in
 * jsdom, with files of their own and a folder both run. Every test is reported once per project
 * that ran it, keyed without the project like `probara import junit` keys jest-junit's file; the
 * `probara.*` helpers of each file reach its results; and when both projects run one file at once,
 * its helper details are left out with one warning, never mixed up.
 */
import type { ReportRequest } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf, type Entries } from './support/expected.js';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const SHARED = 'tests/shared/format.test.js';
const OVERLAP =
  '[probara] Several Jest projects ran this file at once: what the probara.* helpers said about its tests is left out';

/** Every entry of a run of both projects: the shared folder's tests once per project. */
const BOTH_PROJECTS: Entries = {
  'tests/api/orders.test.js > orders lists the orders | SHOP-41': ['passed'],
  'tests/api/orders.test.js > orders refuses a bad order | -': ['failed'],
  'tests/ui/cart.test.js > cart shows the total | SHOP-42': ['passed'],
  [`${SHARED} > format pads a price | -`]: ['passed', 'passed'],
  [`${SHARED} > format rounds a price | -`]: ['skipped', 'skipped'],
};

type Entry = ReportRequest['results'][number];

/** `entries` in a stable order: keys sorted, and the attempts of each. */
function sorted(entries: Entries): Entries {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, statuses]) => [label, [...statuses].sort()]),
  );
}

function resultsOf(fake: FakeProbara): Entry[] {
  return fake.reports().flatMap((report) => report.results);
}

/** What the helpers gave the results of the test whose key ends with `test`, sorted. */
function helpersOf(fake: FakeProbara, test: string): string[] {
  return resultsOf(fake)
    .filter((entry) => entry.automationKey?.endsWith(` > ${test}`) === true)
    .map((entry) => JSON.stringify([entry.parameters ?? null, entry.notes ?? null]))
    .sort();
}

describe.each(JEST_VERSIONS)('Jest projects in $name', (jest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];
  const runs: Record<'overlap' | 'inBand' | 'workers', CommandRun> = {} as never;
  let fake: Record<keyof typeof runs, FakeProbara>;
  let imported: FakeProbara;

  beforeAll(async () => {
    const start = async () => {
      const started = await startFakeProbara({ token: TOKEN });
      fakes.push(started);
      return started;
    };
    fake = { overlap: await start(), inBand: await start(), workers: await start() };
    imported = await start();
    workspace = await createWorkspace(jest, 'projects');
    // First, while Jest knows no test durations: two workers start both runs of the shared file.
    runs.overlap = await workspace.jest(
      [SHARED, '--maxWorkers=2'],
      probaraEnv(fake.overlap.baseUrl),
    );
    runs.inBand = await workspace.jest(['--runInBand'], {
      ...probaraEnv(fake.inBand.baseUrl),
      JEST_JUNIT_ADD_FILE_ATTRIBUTE: 'true',
    });
    const junit = await workspace.probara(
      ['import', 'junit', 'junit.xml'],
      probaraEnv(imported.baseUrl),
    );
    expect(junit.exitCode).toBe(0);
    runs.workers = await workspace.jest(['--maxWorkers=2'], probaraEnv(fake.workers.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((each) => each.close()));
    await workspace.remove();
  });

  it('reports every test once per project that ran it, keyed without the project', () => {
    for (const mode of ['inBand', 'workers'] as const) {
      expect(runs[mode].exitCode).toBe(1);
      expect(sorted(entriesOf(fake[mode].reports()))).toEqual(sorted(BOTH_PROJECTS));
      expect(runs[mode].stdout + runs[mode].stderr).not.toContain(TOKEN);
    }
  });

  it('gives every test the key and cases of `probara import junit` on jest-junit file', () => {
    expect(sorted(entriesOf(imported.reports()))).toEqual(sorted(entriesOf(fake.inBand.reports())));
  });

  it('sends what the helpers of each file said, in node and in jsdom, in workers and in band', () => {
    for (const mode of ['inBand', 'workers'] as const) {
      expect(helpersOf(fake[mode], 'orders lists the orders')).toEqual([
        JSON.stringify([{ environment: 'undefined' }, 'From the api project']),
      ]);
      expect(helpersOf(fake[mode], 'cart shows the total')).toEqual([
        JSON.stringify([{ environment: 'object' }, 'From the ui project']),
      ]);
    }
    // One project after the other: each run of the shared file keeps its own.
    expect(helpersOf(fake.inBand, 'format pads a price')).toEqual([
      JSON.stringify([{ environment: 'object' }, null]),
      JSON.stringify([{ environment: 'undefined' }, null]),
    ]);
    expect(runs.inBand.stderr).not.toContain(OVERLAP);
  });

  it('leaves out the helper details of a file both projects run at once, with one warning', () => {
    expect(runs.overlap.exitCode).toBe(0);
    expect(sorted(entriesOf(fake.overlap.reports()))).toEqual({
      [`${SHARED} > format pads a price | -`]: ['passed', 'passed'],
      [`${SHARED} > format rounds a price | -`]: ['skipped', 'skipped'],
    });
    expect(helpersOf(fake.overlap, 'format pads a price')).toEqual([
      JSON.stringify([null, null]),
      JSON.stringify([null, null]),
    ]);
    expect(runs.overlap.stderr.split('\n').filter((line) => line.includes(OVERLAP))).toEqual([
      `${OVERLAP} (first seen in ${SHARED}; repeats are logged at debug)`,
    ]);
  });
});
