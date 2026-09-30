/**
 * Every relative link and anchor of the READMEs, docs, changelog and policies resolves, and so does
 * every link to a file of this repository on GitHub. The package's own docs ship in the npm
 * tarball, so their relative links never leave `packages/cli/`: a file outside it is linked by its
 * GitHub URL.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { brokenLinks, linksLeavingPackage } from '@probara/test-support/docs/links';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  linkedDocs,
  PACKAGE_DIR,
  REPO_DIR,
  rootMarkdownFiles,
  shown,
  trackedRootMarkdown,
  userDocs,
} from './markdown.js';

/** The links of `file` that resolve nowhere. */
function broken(file: string): string[] {
  return brokenLinks(file);
}

/** Relative links of `file` that point outside the package, where the tarball has nothing. */
function leavingThePackage(file: string): string[] {
  return linksLeavingPackage(file, PACKAGE_DIR);
}

/** Whether this runs in CI: `CI` set to anything but `false` or `0`. */
function inCi(): boolean {
  const ci = process.env.CI ?? '';
  return ci !== '' && ci !== 'false' && ci !== '0';
}

/** The `*.md` names git tracks at the repository root, asked here and not through `markdown.ts`. */
function gitListing(): { names: string[] } | { error: string } {
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
      cwd: REPO_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      names: output.split('\0').filter((name) => name.endsWith('.md') && !name.includes('/')),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The `*.md` names on disk at the repository root that are files, symlinks followed. */
function onDisk(): string[] {
  return readdirSync(REPO_DIR).filter(
    (name) =>
      name.endsWith('.md') && statSync(join(REPO_DIR, name), { throwIfNoEntry: false })?.isFile(),
  );
}

const GIT_FAILED =
  'git cannot list the files at the repository root (git missing, not a checkout, or a safe.directory refusal)';

describe('the Markdown files at the root', () => {
  let dir: string;

  beforeEach(() => {
    // Outside any checkout, so git cannot list it.
    dir = mkdtempSync(join(tmpdir(), 'probara-root-md-'));
    writeFileSync(join(dir, 'README.md'), '# Readme\n');
    writeFileSync(join(dir, 'NOTES.md'), '# Local notes\n');
    writeFileSync(join(dir, 'notes.txt'), 'not Markdown\n');
    mkdirSync(join(dir, 'folder.md'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('are the tracked ones when git lists them, so local notes are not checked', () => {
    expect(rootMarkdownFiles(dir, () => ['README.md', 'CLAUDE.md'])).toEqual([
      join(dir, 'CLAUDE.md'),
      join(dir, 'README.md'),
    ]);
  });

  it('are the files on disk when git cannot list them, without folders', () => {
    expect(rootMarkdownFiles(dir, () => undefined)).toEqual([
      join(dir, 'NOTES.md'),
      join(dir, 'README.md'),
    ]);
  });

  it('cannot be listed by git outside a checkout, so the files on disk are checked', () => {
    expect(trackedRootMarkdown(dir)).toBeUndefined();
    expect(rootMarkdownFiles(dir).map((file) => relative(dir, file))).toEqual([
      'NOTES.md',
      'README.md',
    ]);
  });

  it('on disk count a symlink that resolves, not one that dangles', (context) => {
    try {
      symlinkSync('README.md', join(dir, 'CLAUDE.md'));
      symlinkSync('missing.md', join(dir, 'GONE.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        return context.skip('symlinks are not permitted here (Windows without Developer Mode)');
      }
      throw error;
    }

    expect(rootMarkdownFiles(dir, () => undefined).map((file) => relative(dir, file))).toEqual([
      'CLAUDE.md',
      'NOTES.md',
      'README.md',
    ]);
    expect(broken(join(dir, 'GONE.md'))).toEqual([
      `${shown(join(dir, 'GONE.md'))}: no such file (tracked but missing on disk, or a symlink that dangles)`,
    ]);
  });

  it('fail naming the file when git tracks one that is missing on disk or not a file', () => {
    const files = rootMarkdownFiles(dir, () => ['README.md', 'MISSING.md', 'folder.md']);

    expect(files.flatMap(broken)).toEqual([
      `${shown(join(dir, 'MISSING.md'))}: no such file (tracked but missing on disk, or a symlink that dangles)`,
      `${shown(join(dir, 'folder.md'))}: not a file`,
    ]);
  });
});

describe('links of the docs', () => {
  it('checks every Markdown file git tracks at the repository root, with no list to keep up', (context) => {
    const listing = gitListing();
    if ('error' in listing) {
      if (inCi()) expect.fail(`${GIT_FAILED}: ${listing.error}`);
      return context.skip(GIT_FAILED);
    }

    expect(
      listing.names.length,
      'git ran but tracks no *.md at the repository root',
    ).toBeGreaterThan(0);
    expect(linkedDocs().map(shown)).toEqual(expect.arrayContaining(listing.names));
  });

  it('checks every Markdown file on disk at the repository root that git does not leave out', () => {
    const listing = gitListing();
    const names = onDisk().filter((name) => 'error' in listing || listing.names.includes(name));

    expect(names.length).toBeGreaterThan(0);
    expect(linkedDocs().map(shown)).toEqual(expect.arrayContaining(names));
  });

  it.each(linkedDocs().map((file) => [shown(file), file] as const))(
    '%s links only to files and headings that exist',
    (_name, file) => {
      expect(broken(file)).toEqual([]);
    },
  );

  it.each(userDocs().map((file) => [shown(file), file] as const))(
    '%s links relatively only inside the package',
    (_name, file) => {
      expect(leavingThePackage(file)).toEqual([]);
    },
  );
});
