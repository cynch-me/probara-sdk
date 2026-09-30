/**
 * Whether the links of a Markdown file resolve: relative links and anchors, and links to a file of
 * this repository on GitHub. A package's own docs ship in its npm tarball, so their relative links
 * must never leave the package: a file outside it is linked by its GitHub URL.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { headingAnchors, linksOf, read, REPO_DIR, shown, unreadable } from './markdown.js';

/** Files of this repository on its default branch. */
export const REPOSITORY_BLOB = 'https://github.com/cynch-me/probara-sdk/blob/main/';

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

/** The links of `file` that point to no file, or to no heading of it, each with its line. */
export function brokenLinks(file: string): string[] {
  const problem = unreadable(file);
  if (problem !== undefined) return [problem];
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

/** Relative links of `file` that point outside `packageDir`, where the tarball has nothing. */
export function linksLeavingPackage(file: string, packageDir: string): string[] {
  const name = relative(REPO_DIR, packageDir).replace(/\/$/, '');
  return linksOf(read(file))
    .filter(({ target }) => !isUrl(target) && !target.startsWith('#'))
    .flatMap(({ target, line }) => {
      const [path = ''] = target.split('#');
      const inPackage = relative(packageDir, resolve(dirname(file), decodeURI(path)));
      return inPackage === '..' || inPackage.startsWith('../') || isAbsolute(inPackage)
        ? [`${shown(file)}:${line} ${target}: outside ${name}, use ${REPOSITORY_BLOB}...`]
        : [];
    });
}
