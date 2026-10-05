/**
 * `@probara/core/browser`: the entry an adapter loads in a **browser**, where no Node built-in
 * exists. Nothing may reach one, so a test walks the whole module graph of `browser.ts` and fails
 * on the first `node:` specifier it finds: `@probara/core/metadata` cannot be re-exported here,
 * because `buildAutomationKey` hashes with `node:crypto` (and `node:path`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as browser from './browser.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const BROWSER = join(SRC, 'browser.ts');
const PACKAGE = join(SRC, '..', 'package.json');

interface ImportOf {
  /** The specifier as it is written in the source. */
  specifier: string;
  file: string;
}

/** The specifier of every module a source file names, on one line each or across several. */
const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)'([^']+)'/g;

/** Every import of a source file, whatever the shape its statement has. */
function importsOf(file: string): ImportOf[] {
  const source = readFileSync(file, 'utf8');
  const found: ImportOf[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? '';
    found.push({
      specifier,
      // `.js` in the specifier is the TypeScript source it stands for: the sources import the file
      // the build emits.
      file: specifier.startsWith('.')
        ? resolve(dirname(file), specifier.replace(/\.js$/, '.ts'))
        : '',
    });
  }
  return found;
}

/** Every source file `entry` reaches through its own relative imports, `entry` included. */
function graphOf(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { file: next } of importsOf(file)) if (next !== '') walk(next);
  };
  walk(entry);
  return [...seen].sort();
}

describe('the browser entry of core', () => {
  it('loads no Node built-in, anywhere in its graph', () => {
    const nodeImports: string[] = [];
    for (const file of graphOf(BROWSER)) {
      for (const { specifier } of importsOf(file)) {
        if (specifier.startsWith('node:')) nodeImports.push(`${file}: ${specifier}`);
      }
    }
    // Not one `node:` specifier: a browser frame has no fs, no crypto and no path.
    expect(nodeImports).toEqual([]);
  });

  it('reaches no module that does, either', () => {
    // The graph stays small and explicit: what it holds is what a test frame can speak with.
    expect(graphOf(BROWSER).map((file) => file.slice(SRC.length + 1))).toEqual([
      'browser.ts',
      'case-ids.ts',
      'channel.ts',
      'limits.ts',
      'links.ts',
      'metadata-recorder.ts',
      'metadata.ts',
      'text.ts',
    ]);
  });

  it('is what an adapter loads to speak about the running test', () => {
    const sent: unknown[] = [];
    const warnings: string[] = [];
    const recorder = browser.createMetadataRecorder(
      (message) => sent.push(message),
      (message) => warnings.push(message),
    );
    recorder.id('SHOP-12');
    recorder.title('Adds an item');
    recorder.caseStep('Adds an item', 'An item is in the cart');
    recorder.link('not a url');

    expect(sent).toEqual([
      { type: 'id', value: ['SHOP-12'] },
      { type: 'title', value: 'Adds an item' },
    ]);
    expect(warnings).toEqual([
      'probara.link() takes an absolute http(s) URL of at most 2048 characters',
    ]);
  });

  it('keeps the case ids of titles and the run selection of the protocol', () => {
    expect(browser.extractTitlePathCaseIds(['Cart SHOP-12 adds'], ['SHOP']).titlePath).toEqual([
      'Cart adds',
    ]);
    expect(browser.parseCaseDisplayId('SHOP-12')).toEqual({
      projectCode: 'SHOP',
      number: 12,
    });
    expect(browser.attemptKey('cypress/e2e/cart.cy.js', 'Cart adds', 1)).toBe(
      '["cypress/e2e/cart.cy.js","Cart adds",1]',
    );
    expect(
      browser.parseSelection({
        run: '01J9Z3K4M5N6P7Q8R9S0T1V2W3',
        keys: ['a'],
        caseIds: ['SHOP-12'],
        projectCodes: ['SHOP'],
        keyIncludesFile: true,
        rootDir: '/app',
      })?.caseIds,
    ).toEqual(['SHOP-12']);
    expect(browser.SELECTION_FAILURES).toEqual(['no-hook', 'no-circus', 'failed']);
  });

  it('never exports the automation key, which needs node:crypto and node:path', () => {
    // `@probara/core/metadata` is the entry that has it; a browser frame cannot load that one.
    expect('buildAutomationKey' in browser).toBe(false);
  });
});

describe('the ./browser subpath of the package', () => {
  const manifest = JSON.parse(readFileSync(PACKAGE, 'utf8')) as {
    exports: Record<string, Record<string, string>>;
  };

  it('resolves like the ./metadata one, in both builds', () => {
    expect(manifest.exports['./browser']).toEqual({
      require: {
        types: './dist/cjs/browser.d.ts',
        default: './dist/cjs/browser.js',
      },
      types: './dist/browser.d.ts',
      default: './dist/browser.js',
    });
  });

  it('exports what the entry has, for a require and for an import alike', () => {
    const names = Object.keys(browser).sort();
    expect(names).toEqual([
      'CASE_ANNOTATION',
      'SELECTION_FAILURES',
      'applyMetadataMessage',
      'attemptKey',
      'createMetadataRecorder',
      'emptyMetadata',
      'extractCaseIds',
      'extractTitlePathCaseIds',
      'parseCaseDisplayId',
      'parseCaseIdList',
      'parseSelection',
      'readMetadataMessages',
    ]);
  });
});
