/**
 * The CI job runner of the docs (`jobs.ts`): the `probara import results` paths, and a job whose `vitest` and `probara`
 * lines run as one run while the other lines are skipped.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fencedBlocks } from '@probara/test-support/docs/markdown';
import type { FakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { importResultsPaths, runJob } from './jobs.js';
import { createDocsWorkspace, DOCS_TEST_TIMEOUT_MS, type DocsWorkspace } from './runner.js';
import { startDocsFake } from './scenarios.js';

describe('importResultsPaths', () => {
  it('takes every path and glob, leaving out the values of the flags that take one', async () => {
    expect(
      await importResultsPaths([
        'reports/a.xml',
        '--run-name',
        'Nightly',
        'reports/*.xml',
        '--',
        'x.json',
      ]),
    ).toEqual(['reports/a.xml', 'reports/*.xml', 'x.json']);
  });
});

/** The job of the test: a `vitest` and a `probara` line, with a line the job skips between them. */
function jobBlock(): Parameters<typeof runJob>[0] {
  const [block] = fencedBlocks(
    [
      '```bash',
      'echo "start"',
      'npx vitest run --shard=1/2',
      'probara run create --project SHOP',
      '```',
    ].join('\n'),
  );
  if (block === undefined) throw new Error('the job block is missing');
  return block;
}

/**
 * Runs the job on `fake`, in the workspace `layout` makes. The fake is closed whatever happens, including when the
 * workspace cannot be laid out: a fake left listening would outlive the test.
 */
async function runJobOn(
  fake: FakeProbara,
  layout: () => Promise<DocsWorkspace>,
): ReturnType<typeof runJob> {
  try {
    const workspace = await layout();
    try {
      return await runJob(jobBlock(), { workspace, fake });
    } finally {
      await workspace.remove();
    }
  } finally {
    await fake.close();
  }
}

describe('runJob', { timeout: DOCS_TEST_TIMEOUT_MS }, () => {
  it('runs the vitest and probara lines of a job into one run, and skips the others', async () => {
    const invocations = await runJobOn(await startDocsFake(), () => createDocsWorkspace());
    expect(invocations.map((invocation) => invocation.text)).toEqual([
      'npx vitest run --shard=1/2',
      'probara run create --project SHOP',
    ]);
    expect(invocations.map((invocation) => invocation.exitCode)).toEqual([0, 0]);
  });

  it('closes the fake when the workspace cannot be laid out', async () => {
    const fake = await startDocsFake();
    const missing = join(tmpdir(), 'probara-no-such-folder', 'workspace');

    await expect(runJobOn(fake, () => createDocsWorkspace(undefined, missing))).rejects.toThrow();
    await expect(fetch(fake.baseUrl)).rejects.toThrow();
  });
});
