/**
 * Every relative link and anchor of the READMEs, docs, changelog and policies resolves, and so does
 * every link to a file of this repository on GitHub. The package's own docs ship in the npm
 * tarball, so their relative links never leave `packages/cli/`: a file outside it is linked by its
 * GitHub URL.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  headingAnchors,
  linkedDocs,
  linksOf,
  PACKAGE_DIR,
  read,
  REPO_DIR,
  shown,
  userDocs,
} from './markdown.js';

/** Files of this repository on its default branch. */
const REPOSITORY_BLOB = 'https://github.com/cynch-me/probara-sdk/blob/main/';

function isUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/** The local file a link points to, or `undefined` for a URL outside this repository. */
function destinationOf(file: string, path: string): string | undefined {
  if (path.startsWith(REPOSITORY_BLOB))
    return resolve(REPO_DIR, path.slice(REPOSITORY_BLOB.length));
  if (isUrl(path)) return undefined;
  return path === '' ? file : resolve(dirname(file), decodeURI(path));
}

function broken(file: string): string[] {
  const text = read(file);
  return linksOf(text).flatMap(({ target, line }) => {
    const [path = '', anchor] = target.split('#');
    const destination = destinationOf(file, path);
    if (destination === undefined) return [];
    if (!existsSync(destination)) return [`${shown(file)}:${line} ${target}: no such file`];
    if (anchor === undefined || anchor === '') return [];
    if (statSync(destination).isDirectory() || !destination.endsWith('.md')) {
      return [`${shown(file)}:${line} ${target}: an anchor into a file that is not Markdown`];
    }
    return headingAnchors(read(destination)).has(decodeURIComponent(anchor))
      ? []
      : [`${shown(file)}:${line} ${target}: no heading #${anchor}`];
  });
}

/** Relative links of `file` that point outside the package, where the tarball has nothing. */
function leavingThePackage(file: string): string[] {
  return linksOf(read(file))
    .filter(({ target }) => !isUrl(target) && !target.startsWith('#'))
    .flatMap(({ target, line }) => {
      const [path = ''] = target.split('#');
      const inPackage = relative(PACKAGE_DIR, resolve(dirname(file), decodeURI(path)));
      return inPackage === '..' || inPackage.startsWith('../') || isAbsolute(inPackage)
        ? [`${shown(file)}:${line} ${target}: outside packages/cli, use ${REPOSITORY_BLOB}...`]
        : [];
    });
}

describe('links of the docs', () => {
  it('checks every Markdown file at the repository root, with no list to keep up', () => {
    const tracked = execFileSync('git', ['ls-files', '--', '*.md'], {
      cwd: REPO_DIR,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((path) => path.endsWith('.md') && !path.includes('/'));

    expect(tracked.length).toBeGreaterThan(0);
    expect(linkedDocs().map(shown)).toEqual(expect.arrayContaining(tracked));
  });

  it.each(linkedDocs().map((file) => [shown(file), file] as const))(
    '%s links only to files and headings that exist',
    (_name, file) => {
      expect(existsSync(file)).toBe(true);
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
