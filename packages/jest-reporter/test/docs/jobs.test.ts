/** The docs harness's reading and running of the command lines of a CI job. */
import { startFakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { TOKEN } from '../support/workspace.js';
import { importResultsPaths, runJob } from './jobs.js';
import { createDocsWorkspace } from './runner.js';

describe('importResultsPaths', () => {
  it('takes every path and glob, leaving out the values of the flags that take one', async () => {
    expect(
      await importResultsPaths(['--project', 'SHOP', 'a.json', '--dry-run', 'shard-*.json']),
    ).toEqual(['a.json', 'shard-*.json']);
    expect(await importResultsPaths(['--', '--odd-name.json'])).toEqual(['--odd-name.json']);
  });
});

describe('runJob', () => {
  it('runs the jest and probara lines of a sharded job into one run, and skips the others', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const workspace = await createDocsWorkspace();
      try {
        const content = [
          'npm ci',
          'export PROBARA_RUN_ULID=$(npx @probara/cli run create)',
          'npx jest --shard=1/2',
          'npm test -- --shard=2/2',
          'echo done',
          'npx @probara/cli run close',
        ].join('\n');
        const invocations = await runJob({ lang: 'bash', line: 1, content }, { workspace, fake });

        expect(invocations.map(({ line, text, exitCode }) => ({ line, text, exitCode }))).toEqual([
          { line: 3, text: 'npx @probara/cli run create', exitCode: 0 },
          { line: 4, text: 'npx jest --shard=1/2', exitCode: 0 },
          { line: 5, text: 'npm test -- --shard=2/2', exitCode: 0 },
          { line: 7, text: 'npx @probara/cli run close', exitCode: 0 },
        ]);
        expect(fake.runs().map((run) => run.state)).toEqual(['closed']);
        const keys = fake.reports().flatMap((report) => report.results.map((r) => r.automationKey));
        expect(keys.sort()).toEqual([
          'tests/cart.test.js > cart adds an item',
          'tests/cart.test.js > cart removes an item',
          'tests/login.test.js > login logs in with a valid password',
        ]);
      } finally {
        await workspace.remove();
      }
    } finally {
      await fake.close();
    }
  }, 120_000);
});
