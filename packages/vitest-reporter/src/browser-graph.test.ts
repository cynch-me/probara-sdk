/**
 * The browser entries load no Node module (V10, the graph test of Cypress C-Y1b). The built browser setup files and the
 * `probara.*` browser entry are followed through their static imports: none may import a `node:` or built-in module,
 * nor the main entry of `@probara/core` (it reads the file system); `@probara/core/metadata` is the light entry they use.
 */
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReporter } from '../test/support/reporter-build.js';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

/** The built files a browser run loads: the helpers' browser entry and both browser setup files (by Vitest major). */
const BROWSER_ENTRIES = ['browser.js', 'setup-browser.js', 'setup-browser-v3.js'];

/** The specifiers of the static imports and re-exports of a built file, in the order they appear. */
function specifiersOf(text: string): string[] {
  const pattern =
    /(?:^|[\s;])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]/gu;
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? '');
}

/** Every built file reachable from `entries` through relative imports, with the bare specifiers each one imports. */
function graphOf(entries: readonly string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const pending = entries.map((entry) => join(DIST, entry));
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || graph.has(file)) continue;
    const specifiers = specifiersOf(readFileSync(file, 'utf8'));
    graph.set(file, specifiers);
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) pending.push(resolve(dirname(file), specifier));
    }
  }
  return graph;
}

/** The bare specifiers of the graph that name Node: a `node:` module, a built-in, or the core main entry. */
function nodeImportsOf(graph: Map<string, string[]>): string[] {
  const builtin = new Set(builtinModules);
  return [...graph.values()]
    .flat()
    .filter((specifier) => !specifier.startsWith('.'))
    .filter(
      (specifier) =>
        specifier.startsWith('node:') ||
        builtin.has(specifier) ||
        specifier === '@probara/core' ||
        specifier === 'vitest/node',
    );
}

describe('the browser entries of the package', () => {
  beforeAll(async () => {
    await buildReporter();
  }, 240_000);

  it('are built: the helpers and both browser setup files exist', () => {
    for (const entry of BROWSER_ENTRIES) {
      expect(existsSync(join(DIST, entry)), entry).toBe(true);
    }
  });

  it('import no Node module, directly or through the files they import', () => {
    const graph = graphOf(BROWSER_ENTRIES);
    expect(graph.size).toBeGreaterThan(BROWSER_ENTRIES.length);
    expect(nodeImportsOf(graph)).toEqual([]);
  });

  it('take the helpers of the core metadata entry, not the core main entry', () => {
    const specifiers = [...graphOf(BROWSER_ENTRIES).values()].flat();
    expect(specifiers).toContain('@probara/core/metadata');
    expect(specifiers).not.toContain('@probara/core');
  });

  it('keep the run selection out of the browser setup: it needs the core main entry', () => {
    const graph = graphOf(['setup-browser.js', 'setup-browser-v3.js']);
    const loaded = [...graph.keys()].map((file) => file.slice(DIST.length));
    expect(loaded).not.toContain('run-selection.js');
  });
});
