/** The copy of the docs project an example runs in. */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocProject } from './examples.js';
import { createDocsWorkspace } from './runner.js';

function project(files: [string, string][]): DocProject {
  return {
    id: 'p',
    where: 'x.md:1',
    files: new Map(files),
    ownTests: false,
    exit: 0,
    reports: true,
  };
}

describe('createDocsWorkspace', () => {
  it('lays out the docs project with the files of the example, and removes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'probara-runner-'));
    try {
      const workspace = await createDocsWorkspace(project([['extra/a.txt', 'a']]), root);
      expect(await readdir(root)).toHaveLength(1);
      expect(await readdir(workspace.dir)).toEqual(
        expect.arrayContaining(['extra', 'node_modules', 'playwright.config.ts', 'tests']),
      );
      await workspace.remove();
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes its folder when it cannot be set up', async () => {
    const root = await mkdtemp(join(tmpdir(), 'probara-runner-'));
    try {
      // A file where the docs project has a folder: writing it fails.
      await expect(
        createDocsWorkspace(project([['tests', 'not a folder']]), root),
      ).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
