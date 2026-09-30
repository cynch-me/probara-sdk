/** The copy of the docs project an example runs in. */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProbara } from '@probara/test-support/fake-probara';
import { describe, expect, it } from 'vitest';
import { TOKEN } from '../support/workspace.js';
import { probaraLines, type DocProject } from './examples.js';
import { createDocsWorkspace, docsEnv, isWatchCommand } from './runner.js';

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
