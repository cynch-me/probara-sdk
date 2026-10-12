/**
 * Sharded runs of Vitest, in each supported major, against a fake Probara (V8, V-D4). With the blob reporter beside
 * ours, each shard prepares its workers and sends nothing, and `vitest --merge-reports` sends one run that equals the
 * unsharded run. A blob written without ours carries no attempts, so the merge says so. Without a blob, shards that
 * share one run (`probara run create`, `PROBARA_RUN_ULID`) send into it, and only `probara run close` closes it.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf, type Entries } from './support/expected.js';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 240_000;
const SHARD_LINE =
  'Sharded run with the blob reporter: the results are reported by vitest --merge-reports';
const RETRY_LINE =
  'Vitest retried or repeated 1 test whose earlier attempts were not recorded: only its final attempt is reported';

/** How many times `text` appears in `output`. */
function countOf(output: string, text: string): number {
  return output.split(text).length - 1;
}

describe.each(VITEST_VERSIONS)('$name: shards with the blob reporter, merged once', (vitest) => {
  let full: FakeProbara;
  let merged: FakeProbara;
  let fullRun: CommandRun;
  const shards: CommandRun[] = [];
  const sentByShards: number[] = [];
  const workspaces: Workspace[] = [];
  let mergeRun: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    full = await startFakeProbara({ token: TOKEN });
    merged = await startFakeProbara({ token: TOKEN });
    const reference = await createWorkspace(vitest, 'shards');
    workspaces.push(reference);
    fullRun = await reference.vitest(['run'], probaraEnv(full.baseUrl));

    const workspace = await createWorkspace(vitest, 'shards');
    workspaces.push(workspace);
    const env = probaraEnv(merged.baseUrl);
    for (const index of ['1/2', '2/2']) {
      shards.push(
        await workspace.vitest(['run', '--shard', index, '--config', 'shard.config.mts'], env),
      );
      sentByShards.push(merged.reports().length);
    }
    mergeRun = await workspace.vitest(['--merge-reports'], env);
  }, TIMEOUT);

  afterAll(async () => {
    await full.close();
    await merged.close();
    await Promise.all(workspaces.map((workspace) => workspace.remove()));
  });

  it('sends nothing from the shards, and says once in each shard that the merge reports', () => {
    expect(sentByShards).toEqual([0, 0]);
    for (const shard of shards) {
      expect(countOf(shard.stdout + shard.stderr, SHARD_LINE)).toBe(1);
    }
  });

  it('sends one run from the merge, with every result of the unsharded run once', () => {
    expect(merged.runs()).toHaveLength(1);
    expect(entriesOf(merged.reports())).toEqual(entriesOf(full.reports()));
    expect(merged.reports().flatMap((report) => report.results)).toHaveLength(
      full.reports().flatMap((report) => report.results).length,
    );
  });

  it('keeps the attempts of the retried test, as the unsharded run does', () => {
    const label = 'tests/gamma.test.ts > gamma > retries until it passes | -';
    expect(entriesOf(merged.reports())[label]).toEqual(['failed', 'passed']);
  });

  it('keeps the exit code of the unsharded run, and sends no duplicate line', () => {
    expect(mergeRun.exitCode).toBe(fullRun.exitCode);
    expect(mergeRun.exitCode).toBe(1);
    expect(countOf(mergeRun.stdout + mergeRun.stderr, SHARD_LINE)).toBe(0);
    expect(mergeRun.stdout + mergeRun.stderr).not.toContain(TOKEN);
  });
});

describe.each(VITEST_VERSIONS)('$name: shards with the blob reporter alone', (vitest) => {
  let merged: FakeProbara;
  let mergeRun: CommandRun;
  let workspace: Workspace;
  let entries: Entries;

  beforeAll(async () => {
    await buildReporter();
    merged = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'shards');
    for (const index of ['1/2', '2/2']) {
      await workspace.vitest(['run', '--shard', index, '--config', 'blob-only.config.mts']);
    }
    mergeRun = await workspace.vitest(['--merge-reports'], probaraEnv(merged.baseUrl));
    entries = entriesOf(merged.reports());
  }, TIMEOUT);

  afterAll(async () => {
    await merged.close();
    await workspace.remove();
  });

  it('warns once that the earlier attempts were not recorded, and sends only the final attempt', () => {
    expect(countOf(mergeRun.stdout + mergeRun.stderr, RETRY_LINE)).toBe(1);
    expect(entries['tests/gamma.test.ts > gamma > retries until it passes | -']).toEqual([
      'passed',
    ]);
  });
});

describe.each(VITEST_VERSIONS)('$name: shards that share one run', (vitest) => {
  describe.each([
    { mode: 'one after the other', parallel: false },
    { mode: 'at the same time', parallel: true },
  ])('$mode', ({ parallel }) => {
    let full: FakeProbara;
    let fake: FakeProbara;
    let workspace: Workspace;
    let runUlid: string;
    let shards: CommandRun[];
    let closed: CommandRun;

    beforeAll(async () => {
      await buildReporter();
      full = await startFakeProbara({ token: TOKEN });
      fake = await startFakeProbara({ token: TOKEN });
      const reference = await createWorkspace(vitest, 'shards');
      await reference.vitest(['run'], probaraEnv(full.baseUrl));
      await reference.remove();

      workspace = await createWorkspace(vitest, 'shards');
      const created = await workspace.probara(['run', 'create'], probaraEnv(fake.baseUrl));
      runUlid = created.stdout.trim();
      const env = probaraEnv(fake.baseUrl, { PROBARA_RUN_ULID: runUlid });
      const shard = (index: string) => workspace.vitest(['run', '--shard', index], env);
      if (parallel) shards = await Promise.all(['1/2', '2/2'].map(shard));
      else {
        shards = [];
        for (const index of ['1/2', '2/2']) shards.push(await shard(index));
      }
      closed = await workspace.probara(['run', 'close'], env);
    }, TIMEOUT);

    afterAll(async () => {
      await full.close();
      await fake.close();
      await workspace.remove();
    });

    it('reports every shard into the run of `probara run create`, which only `run close` closes', () => {
      expect(fake.runs().map((run) => run.ulid)).toEqual([runUlid]);
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
      expect(entriesOf(fake.reports())).toEqual(entriesOf(full.reports()));
    });
  });
});
