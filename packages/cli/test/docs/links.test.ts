/** Every relative link and anchor of the READMEs, docs, changelog and policies resolves. */
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { headingAnchors, linkedDocs, linksOf, read, shown } from './markdown.js';

function broken(file: string): string[] {
  const text = read(file);
  return linksOf(text)
    .filter(({ target }) => !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .flatMap(({ target, line }) => {
      const [path = '', anchor] = target.split('#');
      const destination = path === '' ? file : resolve(dirname(file), decodeURI(path));
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

describe('links of the docs', () => {
  it.each(linkedDocs().map((file) => [shown(file), file] as const))(
    '%s links only to files and headings that exist',
    (_name, file) => {
      expect(existsSync(file)).toBe(true);
      expect(broken(file)).toEqual([]);
    },
  );
});
