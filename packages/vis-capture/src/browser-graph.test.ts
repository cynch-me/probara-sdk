/**
 * `@probara/vis-capture` runs on customers' pages and in the browser extension, where no Node
 * built-in exists. A test walks the whole module graph of `index.ts` and fails on the first
 * `node:` specifier, or on any bare specifier: the package has no runtime dependencies.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as capture from './index.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(SRC, 'index.ts');
const PACKAGE = join(SRC, '..', 'package.json');

/** The specifier of every module a source file names, on one line each or across several. */
const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)'([^']+)'/g;

function specifiersOf(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((match) => match[1] ?? '');
}

/** Every source file `entry` reaches through its relative imports, `entry` included. */
function graphOf(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      // `.js` in the specifier is the TypeScript source it stands for.
      if (specifier.startsWith('.'))
        walk(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  };
  walk(entry);
  return [...seen].sort();
}

describe('the module graph of @probara/vis-capture', () => {
  it('imports no Node built-in and no package, anywhere', () => {
    const outside: string[] = [];
    for (const file of graphOf(ENTRY)) {
      for (const specifier of specifiersOf(file)) {
        if (!specifier.startsWith('.')) outside.push(`${file.slice(SRC.length + 1)}: ${specifier}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('reaches only the modules of the package', () => {
    expect(graphOf(ENTRY).map((file) => file.slice(SRC.length + 1))).toEqual([
      'console.ts',
      'entries.ts',
      'index.ts',
      'ndjson.ts',
      'redact.ts',
      'sanitize.ts',
      'serialize.ts',
      'session.ts',
      'version.ts',
    ]);
  });

  it('exports the public API and nothing else', () => {
    expect(Object.keys(capture).sort()).toEqual([
      'CONSOLE_LEVELS',
      'DEFAULT_BUFFER_LIMITS',
      'DIAGNOSTICS_FORMAT_VERSION',
      'MAX_ARGUMENT_LENGTH',
      'NETWORK_KINDS',
      'REDACTED',
      'SANITIZER_REDACTED',
      'USER_EVENT_TYPES',
      'VERSION',
      'createConsoleCapture',
      'createRecordingSession',
      'gzipNdjson',
      'isConsoleEntry',
      'isNetworkEntry',
      'isUserEventEntry',
      'isWebSocketMessageEntry',
      'redactBody',
      'redactHeaders',
      'redactString',
      'sanitizeConsoleEntry',
      'sanitizeNetworkEntry',
      'sanitizeWebSocketEntry',
      'serializeArgument',
      'toNdjson',
    ]);
  });

  it('declares no runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(PACKAGE, 'utf8')) as Record<string, unknown>;
    expect(manifest['dependencies']).toBeUndefined();
    expect(manifest['peerDependencies']).toBeUndefined();
  });
});
