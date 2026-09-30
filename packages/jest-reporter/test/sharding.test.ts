/**
 * Sharded runs of the real `jest` (`--shard`), in each supported version: the shards report into
 * one run made by `probara run create` (`PROBARA_RUN_ULID`), one after the other or at the same
 * time, and together send what one unsharded run sends; only `probara run close` closes the run.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf, FULL_RUN, type Entries } from './support/expected.js';
import {
  createWorkspace,
  JEST_VERSIONS,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const SHARDS = ['1/2', '2/2'] as const;

/** `entries` with the attempts of each key and case in any order. */
function sorted(entries: Entries): Entries {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, statuses]) => [label, [...statuses].sort()]),
  );
}

describe.each(JEST_VERSIONS)('sharded $name runs', (jest) => {
  let workspace: Workspace;
  const fakes: FakeProbara[] = [];

  beforeAll(async () => {
    workspace = await createWorkspace(jest);
  }, TIMEOUT);

  afterAll(async () => {
    await Promise.all(fakes.map((fake) => fake.close()));
    await workspace.remove();
  });

  describe.each([
    { mode: 'one after the other', parallel: false },
    { mode: 'at the same time', parallel: true },
  ])('$mode', ({ parallel }) => {
    let fake: FakeProbara;
    let runUlid: string;
    let shards: CommandRun[];
    let closed: CommandRun;

    beforeAll(async () => {
      fake = await startFakeProbara({ token: TOKEN });
      fakes.push(fake);
      const created = await workspace.probara(['run', 'create'], probaraEnv(fake.baseUrl));
      runUlid = created.stdout.trim();
      const env = probaraEnv(fake.baseUrl, { PROBARA_RUN_ULID: runUlid });
      const shard = (index: string) => workspace.jest([`--shard=${index}`], env);
      if (parallel) shards = await Promise.all(SHARDS.map(shard));
      else {
        shards = [];
        for (const index of SHARDS) shards.push(await shard(index));
      }
      closed = await workspace.probara(['run', 'close'], env);
    }, TIMEOUT);

    it('reports every shard into the run of `probara run create`, which only `run close` closes', () => {
      expect(fake.runs().map((run) => run.ulid)).toEqual([runUlid]);
      expect(fake.reports().map((report) => report.run)).toEqual(
        SHARDS.map(() => ({ ulid: runUlid })),
      );
      expect(fake.reports().some((report) => report.options?.close === true)).toBe(false);
      expect(fake.requestsTo('closeRun')).toHaveLength(1);
      expect(closed.exitCode).toBe(0);
      expect(fake.run(runUlid)?.state).toBe('closed');
      for (const shard of shards) {
        expect(shard.stderr).toMatch(/\[probara\] Recorded \d+ results .* in R-1 \(open\)/);
        expect(shard.stdout + shard.stderr).not.toContain(TOKEN);
      }
    });

    it('sends each test once, from the shard that ran it, as one unsharded run', () => {
      const [first, second] = fake.reports().map((report) => entriesOf([report]));
      // Each shard ran some of the files: no key comes from both.
      expect(Object.keys(first ?? {}).filter((label) => label in (second ?? {}))).toEqual([]);
      expect(sorted(entriesOf(fake.reports()))).toEqual(sorted(FULL_RUN));
    });
  });
});
