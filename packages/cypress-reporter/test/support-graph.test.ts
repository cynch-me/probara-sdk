/**
 * The support file of a Cypress project: `require('@probara/cypress-reporter/support')` loads in
 * the **spec frame**, where Node built-ins do not exist. A `node:` specifier anywhere in its graph
 * is a spec that cannot even load, so a test walks the whole graph from the built file and fails on
 * the first one it finds — and on the reporter's own modules, which the support file must never
 * reach (they report, and they read files).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIR } from './support/workspace.js';

// This package is CommonJS, like the package whose graph this walks: `createRequire` reaches the
// built entry the way Cypress's preprocessor does.
const require = createRequire(__filename);
const DIST = join(PACKAGE_DIR, 'dist');
const ENTRY = join(DIST, 'support.js');

/** Every module `file` reaches through its own relative requires, `file` included. */
function graphOf(file: string): string[] {
  const seen = new Set<string>();
  const walk = (current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const source = readFileSync(current, 'utf8');
    // The compiled CommonJS quotes with `"`, the sources with `'`: both are followed here.
    for (const [, specifier] of source.matchAll(
      /(?:require\(|from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g,
    )) {
      const target = specifier ?? '';
      if (!target.startsWith('.')) continue;
      const resolved = resolve(dirname(current), target);
      walk(statSync(resolved).isDirectory() ? join(resolved, 'index.js') : resolved);
    }
  };
  walk(file);
  return [...seen].sort();
}

/** The modules of this package the support file's graph holds, by their base name. */
function ownModulesOf(files: readonly string[]): string[] {
  return files
    .filter((file) => file.startsWith(DIST))
    .map((file) => file.slice(DIST.length + 1))
    .sort();
}

describe('the built support entry', () => {
  const graph = graphOf(ENTRY);

  it('loads no Node built-in, anywhere in its graph', () => {
    const nodeImports = graph.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/require\(['"](node:[^'"]+)['"]\)/g)].map(
        (match) => `${file.slice(DIST.length + 1)}: ${match[1]}`,
      ),
    );
    expect(nodeImports).toEqual([]);
  });

  it('reaches only the browser side of this package, never the reporter', () => {
    // The reporter, the plugin and the session read files and hold the run: none of them may be in
    // the frame of a spec, whatever pulls the support file in.
    expect(ownModulesOf(graph)).toEqual(['browser-message.js', 'support-api.js', 'support.js']);
  });

  it('publishes the helpers without a Cypress, and never throws while it does', () => {
    // What the entry does in a Node process (a test of this package, a script): nothing at all.
    expect(typeof require(ENTRY)).toBe('object');
    expect((globalThis as { probara?: unknown }).probara).toBeUndefined();
  });

  it('is the file the manifest offers as ./support, and nothing else is bundled for it', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
      exports: Record<string, { default: string }>;
      sideEffects: string[];
    };
    expect(manifest.exports['./support']?.default).toBe('./dist/support.js');
    // A bundler keeps this one file for its effects: without it, Cypress drops the support file.
    expect(manifest.sideEffects).toEqual(['./dist/support.js']);
    expect(readdirSync(DIST).sort()).toEqual(
      expect.arrayContaining(['support-api.d.ts', 'support.d.ts', 'support.js']),
    );
  });
});
