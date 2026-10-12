/**
 * The real Vitest, in each supported major, on the fixture projects, with the built reporter
 * registered by its package name, against a fake Probara.
 */
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entriesOf, PROJECT_RUN } from './support/expected.js';
import { buildReporter } from './support/reporter-build.js';
import {
  createWorkspace,
  probaraEnv,
  runNode,
  TOKEN,
  VITEST_VERSIONS,
  type CommandRun,
  type Workspace,
} from './support/workspace.js';

const TIMEOUT = 180_000;

describe.each(VITEST_VERSIONS)('$name with the reporter, on the project fixture', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest);
    run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('keeps the exit code of the tests, and logs on stderr only, without the token', () => {
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      '[probara] Sending 16 results of 16 tests (8 passed, 3 failed, 5 skipped, 0 blocked)',
    );
    expect(run.stderr).toMatch(/\[probara\] Recorded 16 results .* \(closed\)/);
    expect(run.stdout).not.toContain('[probara]');
    expect(run.stdout + run.stderr).not.toContain(TOKEN);
  });

  it('reports every test with its status, keyed with the file and its describes, in one closed run', () => {
    expect(entriesOf(fake.reports())).toEqual(PROJECT_RUN);
    expect(fake.runs().map((created) => created.state)).toEqual(['closed']);
  });

  it('writes every error of a failed test into its notes, and a todo as Todo', () => {
    const notesOf = (title: string) =>
      fake
        .reports()
        .flatMap((report) => report.results)
        .filter((result) => result.automationKey?.endsWith(title) === true)
        .map((result) => result.notes);
    expect(notesOf('rejects a wrong coupon')).toEqual([
      expect.stringContaining("expected 'WRONG' to be 'RIGHT'"),
    ]);
    const [soft] = notesOf('collects every soft failure');
    expect(soft).toContain('expected 1 to be 2');
    expect(soft).toContain("expected 'a' to be 'b'");
    expect(notesOf('remembers the device')).toEqual(['Todo']);
    expect(
      fake
        .reports()
        .some((report) =>
          report.results.some((result) => result.notes?.includes('\u001b') === true),
        ),
    ).toBe(false);
  });

  it('sends when each test started and how long it took, for every test that ran', () => {
    const ran = fake
      .reports()
      .flatMap((report) => report.results)
      .filter((result) => result.status !== 'skipped');
    expect(ran.length).toBe(11);
    expect(ran.every((result) => typeof result.durationMs === 'number')).toBe(true);
    expect(ran.every((result) => Number.isFinite(Date.parse(result.executedAt ?? '')))).toBe(true);
  });
});

describe.each(VITEST_VERSIONS)(
  '$name with the reporter, when the run cannot be reported',
  (vitest) => {
    let workspace: Workspace;

    beforeAll(async () => {
      await buildReporter();
      workspace = await createWorkspace(vitest);
    }, TIMEOUT);

    afterAll(async () => {
      await workspace.remove();
    });

    it(
      'keeps the exit code of the tests when Probara refuses the results',
      async () => {
        const fake = await startFakeProbara({ token: TOKEN });
        try {
          fake.fail('report', { status: 422 });
          const run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
          expect(run.exitCode).toBe(1);
          expect(run.stderr).toMatch(/\[probara\] \d+ results? (was|were) not sent/);
        } finally {
          await fake.close();
        }
      },
      TIMEOUT,
    );

    it(
      'keeps the exit code of the tests when the reporter throws inside, and says why on stderr',
      async () => {
        // A planted exception: the options getter throws when the reporter reads them at start.
        await writeFile(
          join(workspace.dir, 'planted.config.mts'),
          `import { defineConfig } from 'vitest/config';
const options = {
  get projectId(): string {
    throw new Error('planted: the options broke');
  },
};
export default defineConfig({ test: { reporters: ['default', ['@probara/vitest-reporter', options]] } });
`,
        );
        const fake = await startFakeProbara({ token: TOKEN });
        try {
          const run = await workspace.vitest(
            ['run', '--config', 'planted.config.mts'],
            probaraEnv(fake.baseUrl),
          );
          expect(run.exitCode).toBe(1);
          expect(run.stderr).toContain('planted: the options broke');
          expect(fake.reports()).toEqual([]);
        } finally {
          await fake.close();
        }
      },
      TIMEOUT,
    );
  },
);

describe('the environment of a spawned process', () => {
  it('never inherits the outer runner variables: a Vitest started here is not a worker', async () => {
    // The outer runner is Vitest too: its variables are set here, and must not reach the child.
    process.env.VITEST_POOL_ID = '1';
    process.env.VITE_PROBARA_PROBE = '1';
    try {
      const probe = await runNode(
        [
          '-e',
          'console.log(Object.keys(process.env).filter((name) => /^VITEST|^VITE/.test(name)).join(","))',
        ],
        process.cwd(),
        {},
      );
      expect(probe.stdout.trim()).toBe('');
    } finally {
      delete process.env.VITEST_POOL_ID;
      delete process.env.VITE_PROBARA_PROBE;
    }
  });
});

describe.each(VITEST_VERSIONS)('$name with the reporter, on the failures fixture', (vitest) => {
  let fake: FakeProbara;
  let workspace: Workspace;
  let run: CommandRun;

  beforeAll(async () => {
    await buildReporter();
    fake = await startFakeProbara({ token: TOKEN });
    workspace = await createWorkspace(vitest, 'failures');
    run = await workspace.vitest(['run'], probaraEnv(fake.baseUrl));
  }, TIMEOUT);

  afterAll(async () => {
    await fake.close();
    await workspace.remove();
  });

  it('reports a file that does not load and a suite whose hook threw as failed results, named as the JUnit output names them', () => {
    expect(run.exitCode).toBe(1);
    const entries = entriesOf(fake.reports());
    expect(entries['tests/broken-import.test.ts > tests/broken-import.test.ts | -']).toEqual([
      'failed',
    ]);
    expect(entries['tests/hooks.test.ts > session | -']).toEqual(['failed']);
    // A test under a failed beforeAll is skipped, as the JUnit output has it.
    expect(entries['tests/hooks.test.ts > session > renews the token before expiry | -']).toEqual([
      'skipped',
    ]);
    expect(entries['tests/hooks.test.ts > cart > adds an item | -']).toEqual(['passed']);
    // The import error's message reaches the notes of its result, on every major.
    const brokenImport = fake
      .reports()
      .flatMap((report) => report.results)
      .find(
        (result) =>
          result.automationKey === 'tests/broken-import.test.ts > tests/broken-import.test.ts',
      );
    expect(brokenImport?.notes).toContain('Transform failed with 1 error');
    expect(run.stderr).toContain(
      '[probara] Sending 4 results of 4 tests (1 passed, 2 failed, 1 skipped, 0 blocked)',
    );
    const failed = fake
      .reports()
      .flatMap((report) => report.results)
      .find((result) => result.automationKey === 'tests/hooks.test.ts > session');
    expect(failed?.notes).toContain('the seed data is missing');
  });
});
