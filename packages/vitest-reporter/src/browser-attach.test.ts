import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachFile, type AttachContext } from './browser-attach.js';
import { fileRulesOf, loadVite, type FileRules, type ViteModule } from './vite-rules.js';

/** The reason a path was refused, or an empty text when it was copied. */
function problemOf(outcome: ReturnType<typeof attachFile>): string {
  return outcome !== null && 'problem' in outcome ? outcome.problem : '';
}

/**
 * The browser attach decides what Vite serves with Vite's own rules (V-D103): the project's `server.fs` lists, Vite's
 * defaults and the real path of a symlink. The configurations are resolved by the Vite that the reporter loads.
 */
describe("the browser attach follows Vite's own file rules", () => {
  let root: string;
  let outside: string;
  let folder: string;
  let vite: ViteModule;
  /** The file check of that Vite, as the reporter passes it to the attach. */
  let rules: FileRules | undefined;
  /** Vite's defaults: the project sets no `server.fs`. */
  let withDefaults: AttachContext;
  /** A project's own `server.fs.deny`, which replaces Vite's defaults. */
  let withOwnDeny: AttachContext;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'probara-attach-root-')));
    outside = await realpath(await mkdtemp(join(tmpdir(), 'probara-attach-outside-')));
    folder = await realpath(await mkdtemp(join(tmpdir(), 'probara-attach-folder-')));
    await writeFile(join(root, 'receipt.txt'), 'a receipt');
    await mkdir(join(root, 'refused'));
    await writeFile(join(root, 'refused', 'note.txt'), 'a refused note');
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), 'a git config');
    await writeFile(join(outside, 'receipt.txt'), 'outside the project');
    await symlink(join(outside, 'receipt.txt'), join(root, 'linked.txt'));
    const loaded = await loadVite(fileURLToPath(new URL('../', import.meta.url)));
    if (loaded === undefined) throw new Error('Vite cannot be loaded from the package');
    vite = loaded;
    rules = fileRulesOf(vite).check;
    const defaults = await vite.resolveConfig(
      { root, configFile: false, logLevel: 'silent' },
      'serve',
    );
    const owned = await vite.resolveConfig(
      { root, configFile: false, logLevel: 'silent', server: { fs: { deny: ['**/refused/**'] } } },
      'serve',
    );
    withDefaults = { project: { config: { root }, vite: { config: defaults } } };
    withOwnDeny = { project: { config: { root }, vite: { config: owned } } };
  });

  afterAll(async () => {
    await Promise.all(
      [root, outside, folder].map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('copies a file that Vite serves', () => {
    const outcome = attachFile(folder, withDefaults, { path: 'receipt.txt' }, rules);
    expect(outcome).toMatchObject({ staged: { source: 'receipt.txt' } });
  });

  it("refuses a file that the project's server.fs.deny lists, inside a folder Vite serves", async () => {
    const before = (await readdir(folder)).length;
    const outcome = attachFile(folder, withOwnDeny, { path: 'refused/note.txt' }, rules);
    expect(outcome).toEqual({
      problem: `Vite does not serve "${join(root, 'refused', 'note.txt')}" (server.fs.allow or server.fs.deny)`,
    });
    expect((await readdir(folder)).length).toBe(before);
  });

  it("serves what Vite serves once the project sets its own server.fs.deny: the list replaces Vite's defaults", () => {
    const outcome = attachFile(folder, withOwnDeny, { path: '.git/config' }, rules);
    expect(outcome).toMatchObject({ staged: { source: 'config' } });
  });

  it("refuses a file in .git, which Vite's default server.fs.deny lists", () => {
    const outcome = attachFile(folder, withDefaults, { path: '.git/config' }, rules);
    expect(problemOf(outcome)).toContain('Vite does not serve');
  });

  it('refuses a symlink in the project that points outside the folders Vite serves', () => {
    const outcome = attachFile(folder, withDefaults, { path: 'linked.txt' }, rules);
    expect(problemOf(outcome)).toContain('Vite does not serve');
  });

  it('refuses a file outside server.fs.allow, and names the file', () => {
    const file = join(outside, 'receipt.txt');
    const outcome = attachFile(
      folder,
      withDefaults,
      { path: join('..', basename(outside), 'receipt.txt') },
      rules,
    );
    expect(outcome).toEqual({
      problem: `Vite does not serve "${file}" (server.fs.allow or server.fs.deny)`,
    });
  });

  it("names the problem when Vite's file rules cannot be loaded for the run", () => {
    const outcome = attachFile(folder, withDefaults, { path: 'receipt.txt' }, undefined);
    expect(problemOf(outcome)).toContain('not reachable');
  });
});
