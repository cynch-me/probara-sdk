/** The copy of the docs project an example runs in. */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { TOKEN } from '../support/workspace.js';
import { pageOf, probaraLines, unshownLines, type DocProject } from './examples.js';
import { createDocsWorkspace, docsEnv, isWatchCommand, watchSession } from './runner.js';

function project(files: [string, string][], ownTests = false): DocProject {
  return { id: 'p', where: 'x.md:1', files: new Map(files), ownTests, exit: 0, reports: true };
}

/** Runs `use` on a workspace of `docs` laid out in a fresh folder, then removes both. */
async function inRoot(use: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'probara-jest-runner-'));
  try {
    await use(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * The run check of a one-block config example: whether it reported, and its `[probara]` lines
 * that no output block shows.
 */
async function runConfigExample(block: string): Promise<{ reports: number; unshown: string[] }> {
  const [example] = pageOf('x.md', `\`\`\`js\n${block}\n\`\`\`\n`).projects;
  const fake = await startFakeProbara({ token: TOKEN });
  try {
    const workspace = await createDocsWorkspace(example);
    try {
      const run = await workspace.run(
        { kind: 'jest', args: ['--runInBand'], assignments: [] },
        docsEnv(fake, {}, example),
      );
      const context = { baseUrl: fake.baseUrl, dir: workspace.dir };
      return { reports: fake.reports().length, unshown: unshownLines(run.stderr, [], context) };
    } finally {
      await workspace.remove();
    }
  } finally {
    await fake.close();
  }
}

describe('isWatchCommand', () => {
  it('knows a jest command in watch mode, which never exits on its own', () => {
    const jest = (...args: string[]) => ({ kind: 'jest' as const, args, assignments: [] });
    expect(isWatchCommand(jest('--watchAll'))).toBe(true);
    expect(isWatchCommand(jest('tests/cart', '--watch'))).toBe(true);
    expect(isWatchCommand(jest('--watchAll=true'))).toBe(true);
    expect(isWatchCommand(jest('--ci'))).toBe(false);
    expect(isWatchCommand(jest('--watchAll=false'))).toBe(false);
    expect(isWatchCommand({ kind: 'probara', args: ['--watchAll'], assignments: [] })).toBe(false);
  });
});

describe('createDocsWorkspace', () => {
  it('lays out the docs project with the files of the example, and removes it', async () => {
    await inRoot(async (root) => {
      const workspace = await createDocsWorkspace(project([['extra/a.txt', 'a']]), root);
      expect(await readdir(root)).toHaveLength(1);
      expect(await readdir(workspace.dir)).toEqual(
        expect.arrayContaining([
          'extra',
          'jest.config.js',
          'node_modules',
          'package.json',
          'tests',
        ]),
      );
      expect(existsSync(join(workspace.dir, 'node_modules/@probara/jest-reporter/dist'))).toBe(
        true,
      );
      await workspace.remove();
      expect(await readdir(root)).toEqual([]);
    });
  });

  it('leaves the default tests out when the example has its own', async () => {
    await inRoot(async (root) => {
      const workspace = await createDocsWorkspace(
        project([['tests/pay.test.js', "test('pays', () => {});\n"]], true),
        root,
      );
      expect(await readdir(join(workspace.dir, 'tests'))).toEqual(['pay.test.js']);
    });
  });

  it.each([
    ['jest.config.mjs', 'export default {};\n'],
    ['jest.config.cjs', 'module.exports = {};\n'],
    ['package.json', '{ "jest": { "testEnvironment": "node" } }\n'],
  ])('leaves the default config out when the example brings %s', async (path, content) => {
    await inRoot(async (root) => {
      const workspace = await createDocsWorkspace(project([[path, content]]), root);
      expect(existsSync(join(workspace.dir, 'jest.config.js'))).toBe(false);
    });
  });

  it('keeps the default config next to a package.json without a jest key', async () => {
    await inRoot(async (root) => {
      const workspace = await createDocsWorkspace(
        project([['package.json', '{ "type": "commonjs" }\n']]),
        root,
      );
      expect(existsSync(join(workspace.dir, 'jest.config.js'))).toBe(true);
    });
  });

  it('runs a watch session until Jest re-ran, calling between before each re-run', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const workspace = await createDocsWorkspace();
      try {
        const between: number[] = [];
        const run = await workspace.watch(
          { kind: 'jest', args: ['--watchAll'], assignments: [] },
          docsEnv(fake),
          {
            runs: 2,
            between: (ended) => {
              between.push(ended, fake.reports().length);
            },
          },
        );

        expect(run.exitCode).toBe(0);
        expect(between).toEqual([1, 1]);
        expect(fake.reports()).toHaveLength(2);
        expect(probaraLines(run.stderr).filter((line) => line.includes('Recorded'))).toHaveLength(
          2,
        );
      } finally {
        await workspace.remove();
      }
    } finally {
      await fake.close();
    }
  }, 120_000);

  it('runs a watch session of tests outside tests/, saving one of them', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const workspace = await createDocsWorkspace(
        project([['__tests__/pay.test.js', "test('pays', () => {});\n"]], true),
      );
      try {
        const run = await workspace.watch(
          { kind: 'jest', args: ['--watchAll'], assignments: [] },
          docsEnv(fake),
          { runs: 2 },
        );

        expect(fake.reports(), run.stderr).toHaveLength(2);
      } finally {
        await workspace.remove();
      }
    } finally {
      await fake.close();
    }
  }, 120_000);

  it('refuses a watch session without a test file to save', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const workspace = await createDocsWorkspace(project([], true));
      try {
        await expect(
          workspace.watch({ kind: 'jest', args: ['--watchAll'], assignments: [] }, docsEnv(fake), {
            runs: 2,
          }),
        ).rejects.toThrow('a watch session needs a test file');
        expect(fake.requests).toEqual([]);
      } finally {
        await workspace.remove();
      }
    } finally {
      await fake.close();
    }
  });

  it('gives a watch session the exit code of its last run: 1 when a test failed', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const workspace = await createDocsWorkspace(
        project(
          [['tests/pay.test.js', "test('pays', () => { throw new Error('declined'); });\n"]],
          true,
        ),
      );
      try {
        const run = await workspace.watch(
          { kind: 'jest', args: ['--watchAll'], assignments: [] },
          docsEnv(fake),
          { runs: 2 },
        );

        expect(run.exitCode, run.stderr).toBe(1);
      } finally {
        await workspace.remove();
      }
    } finally {
      await fake.close();
    }
  }, 120_000);

  it('fails a watch session whose jest cannot start, with the reason', async () => {
    await inRoot(async (root) => {
      const gone = join(root, 'gone');
      await expect(
        watchSession({
          dir: gone,
          file: join(gone, 'tests', 'a.test.js'),
          args: ['--watchAll'],
          env: {},
          plan: { runs: 2 },
          deadline: Date.now() + 10_000,
        }),
      ).rejects.toThrow(/ENOENT/);
    });
  });

  it('stops a jest that does not end in time, failing with what it printed', async () => {
    const workspace = await createDocsWorkspace(
      project(
        [
          [
            'tests/open.test.js',
            "test('leaves a timer', () => { setInterval(() => {}, 1000); });\n",
          ],
        ],
        true,
      ),
      undefined,
      20_000,
    );
    try {
      const started = Date.now();
      await expect(
        workspace.run({ kind: 'jest', args: [], assignments: [] }, { PROBARA_ENABLED: 'false' }),
      ).rejects.toThrow(/did not end in time[\s\S]*Jest did not exit one second/);
      expect(Date.now() - started).toBeLessThan(30_000);
    } finally {
      await workspace.remove();
    }
  }, 60_000);

  it('ends a watch session at the deadline of its workspace, failing with what jest printed', async () => {
    const fake = await startFakeProbara({ token: TOKEN });
    try {
      const workspace = await createDocsWorkspace(undefined, undefined, 20_000);
      try {
        const started = Date.now();
        await expect(
          workspace.watch({ kind: 'jest', args: ['--watchAll'], assignments: [] }, docsEnv(fake), {
            runs: 50,
          }),
        ).rejects.toThrow(/jest ended \d+ of 50 runs in time/);
        expect(Date.now() - started).toBeLessThan(30_000);
      } finally {
        await workspace.remove();
      }
    } finally {
      await fake.close();
    }
  }, 60_000);

  it('removes its folder when it cannot be set up', async () => {
    await inRoot(async (root) => {
      // A file where the docs project has a folder: writing it fails.
      await expect(
        createDocsWorkspace(project([['tests', 'not a folder']]), root),
      ).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
    });
  });
});

describe('the run check of a config example', () => {
  it.each([
    ['projectID', "{ projectID: 'SHOP' }"],
    ['captureOutputs', "{ projectId: 'SHOP', captureOutputs: true }"],
  ])(
    'fails a config that misspells %s: the warning is a line no output block shows',
    async (option, options) => {
      const { unshown } = await runConfigExample(
        `reporters: ['default', ['@probara/jest-reporter', ${options}]],`,
      );

      expect(unshown).toContain(
        `[probara] Ignored the unknown option "${option}" of @probara/jest-reporter`,
      );
    },
    120_000,
  );

  it('runs a config that names projectId without PROBARA_PROJECT: the option alone reports', async () => {
    // Jest ignores a top-level projectId: only the reporter's options name the project.
    const misplaced = await runConfigExample(
      "reporters: ['default', '@probara/jest-reporter'],\nprojectId: 'SHOP',",
    );
    const named = await runConfigExample(
      "reporters: ['default', ['@probara/jest-reporter', { projectId: 'SHOP' }]],",
    );

    expect(misplaced.reports).toBe(0);
    expect(named).toEqual({ reports: 1, unshown: [] });
  }, 240_000);
});
