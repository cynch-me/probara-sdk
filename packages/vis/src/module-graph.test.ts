/**
 * `@probara/vis` runs on customers' pages. Its module graph reaches no Node built-in and no
 * package but the capture engine, it exports its public API and nothing else, and the script-tag
 * entry exports the same API as the npm one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as vis from './index.js';
import * as script from './script.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(SRC, '..', 'package.json');
const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)'([^']+)'/g;

function specifiersOf(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((match) => match[1] ?? '');
}

function graphOf(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.'))
        walk(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  };
  walk(entry);
  return [...seen].sort();
}

describe('the module graph of @probara/vis', () => {
  it('imports the capture engine and nothing else outside the package', () => {
    const outside = new Set<string>();
    for (const entry of ['index.ts', 'script.ts']) {
      for (const file of graphOf(join(SRC, entry))) {
        for (const specifier of specifiersOf(file)) {
          if (!specifier.startsWith('.')) outside.add(specifier);
        }
      }
    }
    expect([...outside]).toEqual(['@probara/vis-capture']);
  });

  it('exports the public API and nothing else', () => {
    expect(Object.keys(vis).sort()).toEqual([
      'BLUR_META_NAME',
      'PRIVACY_SELECTORS',
      'RECORDING_TOKEN_PARAM',
      'VERSION',
      'isRecordingSupported',
      'metadata',
      'startRecorder',
      'startRecorderFromUrl',
    ]);
  });

  it('exports the same API from the script-tag entry', () => {
    expect(Object.keys(script).sort()).toEqual(Object.keys(vis).sort());
  });

  it('declares the capture engine as its only runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(PACKAGE, 'utf8')) as Record<string, unknown>;
    expect(manifest['dependencies']).toEqual({ '@probara/vis-capture': 'workspace:*' });
    expect(manifest['peerDependencies']).toBeUndefined();
  });

  it('touches no browser API when imported: the script entry starts nothing without a page', () => {
    // Importing both entries on Node, where no window exists, threw nothing above.
    expect(vis.startRecorderFromUrl()).toBeNull();
    expect(vis.isRecordingSupported()).toBe(false);
  });
});
