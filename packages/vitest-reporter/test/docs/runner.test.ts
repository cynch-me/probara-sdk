/**
 * The runner of the docs examples: a throwaway copy of the docs project with the files of an example, the real Vitest 5
 * and `probara` bins in it, a watch session that saves a file for each re-run, and a budget every command ends within.
 */
import { access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from '../support/reporter-build.js';
import { createDocsWorkspace, DOCS_TEST_TIMEOUT_MS, isWatchCommand } from './runner.js';
import type { Command } from './examples.js';

const command = (args: string[]): Command => ({ kind: 'vitest', args, assignments: [] });

describe('isWatchCommand', () => {
  it('knows a vitest command in watch mode, which never exits on its own', () => {
    expect(isWatchCommand(command(['--watch']))).toBe(true);
    expect(isWatchCommand(command(['watch']))).toBe(true);
    expect(isWatchCommand(command(['--watch=false']))).toBe(false);
    expect(isWatchCommand(command(['run', '--reporter=dot']))).toBe(false);
    expect(isWatchCommand({ kind: 'probara', args: ['--watch'], assignments: [] })).toBe(false);
  });
});

describe('createDocsWorkspace', { timeout: DOCS_TEST_TIMEOUT_MS }, () => {
  // The layout copies the built reporter: it is built first, as the end-to-end tests build it.
  beforeAll(() => buildReporter(), DOCS_TEST_TIMEOUT_MS);

  it('lays out the docs project with the files of the example, and removes it', async () => {
    const workspace = await createDocsWorkspace({
      id: 'p',
      where: 'docs/x.md:1',
      files: new Map([
        ['tests/extra.test.ts', "import { it } from 'vitest';\nit('extra', () => {});\n"],
      ]),
      ownTests: false,
      exit: 0,
      reports: true,
    });
    try {
      await access(join(workspace.dir, 'vitest.config.mts'));
      await access(join(workspace.dir, 'node_modules', 'vitest', 'package.json'));
      await access(
        join(workspace.dir, 'node_modules', '@probara', 'vitest-reporter', 'dist', 'index.js'),
      );
      await access(join(workspace.dir, 'tests', 'extra.test.ts'));
    } finally {
      await workspace.remove();
    }
    await expect(access(workspace.dir)).rejects.toThrow();
  });

  it('leaves the default tests out when the example has its own', async () => {
    const workspace = await createDocsWorkspace({
      id: 'p',
      where: 'docs/x.md:1',
      files: new Map([
        ['tests/own.test.ts', "import { it } from 'vitest';\nit('own', () => {});\n"],
      ]),
      ownTests: true,
      exit: 0,
      reports: true,
    });
    try {
      expect(await readdir(join(workspace.dir, 'tests'))).toEqual(['own.test.ts']);
    } finally {
      await workspace.remove();
    }
  });

  it('removes its folder when a file of the example cannot be written', async () => {
    const before = await readdir(tmpdir());
    await expect(
      createDocsWorkspace({
        id: 'p',
        where: 'docs/x.md:1',
        // `package.json` is a file of the docs project: a file under it cannot be made.
        files: new Map([['package.json/nested.ts', 'export {};\n']]),
        ownTests: false,
        exit: 0,
        reports: true,
      }),
    ).rejects.toThrow();
    const after = await readdir(tmpdir());
    expect(
      after.filter((name) => name.startsWith('probara-vitest-docs-') && !before.includes(name)),
    ).toEqual([]);
  });

  it('ends a command that is still running at its budget, failing with what it printed', async () => {
    const workspace = await createDocsWorkspace(undefined, tmpdir(), 0);
    try {
      await expect(
        workspace.run({ kind: 'probara', args: ['--help'], assignments: [] }, {}),
      ).rejects.toThrow('did not end in time');
    } finally {
      await workspace.remove();
    }
  });

  it(
    'runs a watch session until Vitest re-ran, calling between before each re-run, then stops it',
    async () => {
      const workspace = await createDocsWorkspace();
      const between: number[] = [];
      try {
        const run = await workspace.watch(
          { kind: 'vitest', args: ['--watch'], assignments: [] },
          {},
          { runs: 2, between: (ended) => void between.push(ended) },
        );
        expect(between).toEqual([1]);
        expect(run.stdout.match(/^\s+Duration\s/gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(run.exitCode).toBe(0);
      } finally {
        await workspace.remove();
      }
    },
    DOCS_TEST_TIMEOUT_MS,
  );

  it(
    'keeps a watch session until every reporter ended its last run, not only the summary',
    async () => {
      // A reporter still busy after Vitest printed its summary, as the Probara reporter is while it sends a run.
      const workspace = await createDocsWorkspace({
        id: 'slow',
        where: 'docs/x.md:1',
        files: new Map([
          [
            'vitest.config.mts',
            "import { defineConfig } from 'vitest/config';\n" +
              "export default defineConfig({ test: { include: ['tests/**/*.test.ts'], reporters: ['default', './slow-reporter.mjs'] } });\n",
          ],
          [
            'slow-reporter.mjs',
            'export default class SlowReporter {\n' +
              '  async onTestRunEnd() {\n' +
              '    await new Promise((resolve) => setTimeout(resolve, 1_500));\n' +
              "    process.stderr.write('[slow] the run is reported\\n');\n" +
              '  }\n' +
              '}\n',
          ],
        ]),
        ownTests: false,
        exit: 0,
        reports: false,
      });
      try {
        const run = await workspace.watch(
          { kind: 'vitest', args: ['--watch'], assignments: [] },
          {},
          { runs: 2 },
        );
        expect(run.stderr.match(/\[slow\] the run is reported/g)?.length ?? 0, run.stderr).toBe(2);
      } finally {
        await workspace.remove();
      }
    },
    DOCS_TEST_TIMEOUT_MS,
  );

  it('refuses a watch session without a test file to save', async () => {
    const workspace = await createDocsWorkspace({
      id: 'p',
      where: 'docs/x.md:1',
      files: new Map([['notes.txt', 'no tests here']]),
      ownTests: true,
      exit: 0,
      reports: true,
    });
    try {
      await expect(
        workspace.watch({ kind: 'vitest', args: ['--watch'], assignments: [] }, {}, { runs: 2 }),
      ).rejects.toThrow('a watch session needs a test file to save');
    } finally {
      await workspace.remove();
    }
  });
});
