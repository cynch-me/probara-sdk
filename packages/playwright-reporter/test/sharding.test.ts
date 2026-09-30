/**
 * Sharded runs: shards report into one run made by `probara run create`, and
 * `playwright merge-reports` sends the blob reports of every shard, attachments included.
 */
import { cp, mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  startFakeProbara,
  type FakeProbara,
  type FakeStagedFile,
} from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf, FULL_RUN, type Entries } from './support/expected.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;
const SHARDS = ['1/2', '2/2'] as const;

function countByType(files: readonly FakeStagedFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) counts[file.type] = (counts[file.type] ?? 0) + 1;
  return counts;
}

/** `entries` with the attempts of each key and case in any order: the shards split them. */
function sorted(entries: Entries): Entries {
  return Object.fromEntries(
    Object.entries(entries).map(([label, statuses]) => [label, [...statuses].sort()]),
  );
}

describe('sharded playwright runs', () => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let runUlid: string;
  let shards: CommandRun[];
  let closed: CommandRun;

  beforeAll(async () => {
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace();
    const created = await workspace.probara(['run', 'create'], probaraEnv(fake.baseUrl));
    runUlid = created.stdout.trim();
    shards = [];
    for (const [index, shard] of SHARDS.entries()) {
      shards.push(
        await workspace.playwright(
          ['test', `--shard=${shard}`, '--reporter=@probara/playwright-reporter,blob'],
          {
            ...probaraEnv(fake.baseUrl, { PROBARA_RUN_ULID: runUlid }),
            FIXTURE_OUTPUT_DIR: `test-results-${index + 1}`,
          },
        ),
      );
      // Each shard writes `blob-report/`, emptying it first: keep its report aside.
      await rename(join(workspace.dir, 'blob-report'), join(workspace.dir, `blob-${index + 1}`));
    }
    closed = await workspace.probara(
      ['run', 'close'],
      probaraEnv(fake.baseUrl, { PROBARA_RUN_ULID: runUlid }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('reports every shard into the run of `probara run create`, which `run close` closes', () => {
    expect(fake.runs().map((run) => run.ulid)).toEqual([runUlid]);
    expect(
      fake.reports().every((report) => 'ulid' in report.run && report.run.ulid === runUlid),
    ).toBe(true);
    // No shard closes the shared run: only `probara run close` does.
    expect(fake.reports().some((report) => report.options?.close === true)).toBe(false);
    expect(fake.requestsTo('closeRun')).toHaveLength(1);
    expect(closed.exitCode).toBe(0);
    expect(fake.run(runUlid)?.state).toBe('closed');
  });

  it('sends each test once, from the shard that ran it, with the keys of a full run', () => {
    expect(shards.map((shard) => shard.stderr)).toEqual([
      expect.stringMatching(/\[probara\] Recorded \d+ results .* \(open\)/),
      expect.stringMatching(/\[probara\] Recorded \d+ results .* \(open\)/),
    ]);
    expect(sorted(entriesOf(fake.reports()))).toEqual(sorted(FULL_RUN));
  });

  it(
    'sends the merged blob reports of every shard, with their attachments, into one run',
    async () => {
      const merged = join(workspace.dir, 'all-blobs');
      await mkdir(merged);
      for (const blob of ['blob-1', 'blob-2']) {
        for (const file of await readdir(join(workspace.dir, blob))) {
          await cp(join(workspace.dir, blob, file), join(merged, file));
        }
      }
      const mergeFake = await startFakeProbara({ token: TOKEN });
      try {
        const run = await workspace.playwright(
          ['merge-reports', '--reporter', '@probara/playwright-reporter', 'all-blobs'],
          probaraEnv(mergeFake.baseUrl),
        );

        expect(run.stderr).toMatch(/\[probara\] Recorded 46 results .* in R-1 \(closed\)/);
        expect(sorted(entriesOf(mergeFake.reports()))).toEqual(sorted(FULL_RUN));
        // The same files the shards uploaded themselves. Merged attachments come out of the blobs
        // under content-hashed names (`<sha1>.zip`), which core uploads as they are.
        expect(countByType(mergeFake.stagedFiles())).toEqual(countByType(fake.stagedFiles()));
        expect(countByType(mergeFake.stagedFiles())).toMatchObject({
          'application/zip': 44,
          'image/png': 2,
          'application/json': 2,
        });
      } finally {
        await mergeFake.close();
      }
    },
    TIMEOUT,
  );
});
