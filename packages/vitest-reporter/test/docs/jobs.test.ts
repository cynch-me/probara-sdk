/**
 * The CI job runner of the docs (`jobs.ts`): the `probara import results` paths, and a job whose `vitest` and `probara`
 * lines run as one run while the other lines are skipped.
 */
import { fencedBlocks } from '@probara/test-support/docs/markdown';
import { describe, expect, it } from 'vitest';
import { importResultsPaths, runJob } from './jobs.js';
import { createDocsWorkspace, DOCS_TEST_TIMEOUT_MS } from './runner.js';
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

describe('runJob', { timeout: DOCS_TEST_TIMEOUT_MS }, () => {
  it('runs the vitest and probara lines of a job into one run, and skips the others', async () => {
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
    const fake = await startDocsFake();
    const workspace = await createDocsWorkspace();
    try {
      const invocations = await runJob(block, {
        workspace,
        fake,
      });
      expect(invocations.map((invocation) => invocation.text)).toEqual([
        'npx vitest run --shard=1/2',
        'probara run create --project SHOP',
      ]);
      expect(invocations.map((invocation) => invocation.exitCode)).toEqual([0, 0]);
    } finally {
      await workspace.remove();
      await fake.close();
    }
  });
});
