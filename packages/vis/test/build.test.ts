/**
 * The build: an ES module with its types for npm, which imports the capture engine as a package,
 * and one self-contained script-tag file that sets the global `ProbaraVis`. The test builds the
 * engine, then this package, with the real tsdown, and loads the outputs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { buildWhenStale, VIS_CAPTURE_BUILD } from '@probara/test-support/build';
import { beforeAll, describe, expect, it } from 'vitest';
import * as source from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = join(ROOT, '..', 'vis-capture');
const DIST = join(ROOT, 'dist');
const IIFE = join(DIST, 'vis.iife.js');

/**
 * The most the script-tag file may weigh, gzip-compressed: the recorder and in-app reporting
 * (the panel with its light and dark colours, icons and the Probara mark, the launcher, the
 * pre-click buffers); rrweb is loaded apart, only for an instant replay.
 */
const IIFE_GZIP_BUDGET = 38 * 1024;

beforeAll(async () => {
  // The npm build reads the engine's built types; the script build bundles its built code. The
  // engine is built through its lock: other packages' tests build it at the same time.
  await buildWhenStale(VIS_CAPTURE_BUILD);
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsdown'), [], { cwd: ROOT, stdio: 'pipe' });
}, 120_000);

describe('the build of @probara/vis', () => {
  it('writes an ES module with the exports of the source, and its types', async () => {
    const built = (await import(pathToFileURL(join(DIST, 'index.js')).href)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(built).sort()).toEqual(Object.keys(source).sort());
    expect(built['VERSION']).toBe(source.VERSION);
    const types = readFileSync(join(DIST, 'index.d.ts'), 'utf8');
    expect(types).toContain('startRecorderFromUrl');
    expect(types).toMatch(/from\s*["']@probara\/vis-capture["']/);
  });

  it('imports the capture engine as a package in the ES module, never bundling it', () => {
    const code = readFileSync(join(DIST, 'index.js'), 'utf8');
    const packages = [...code.matchAll(/^import[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(packages).toEqual(['@probara/vis-capture']);
    // The engine's redaction marker lives in the engine only.
    expect(code).not.toContain('PROBARA_REDACTED');
  });

  it('writes one self-contained script-tag file that sets the ProbaraVis global', () => {
    const code = readFileSync(IIFE, 'utf8');
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).not.toContain('@probara/vis-capture"');
    expect(code).toContain('PROBARA_REDACTED');
    const context: Record<string, unknown> = {};
    context['globalThis'] = context;
    // No page: the script must load without throwing and open nothing.
    runInNewContext(code, context);
    const global = context['ProbaraVis'] as Record<string, unknown> | undefined;
    expect(Object.keys(global ?? {}).sort()).toEqual(Object.keys(source).sort());
    expect(global?.['VERSION']).toBe(source.VERSION);
  });

  it('keeps the script-tag file within its size budget', () => {
    const code = readFileSync(IIFE);
    expect(gzipSync(code).length).toBeLessThanOrEqual(IIFE_GZIP_BUDGET);
  });

  it('points every path of the package exports at a built file', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, string | Record<string, string>>;
      types: string;
      unpkg: string;
      jsdelivr: string;
    };
    const paths = [manifest.types, manifest.unpkg, manifest.jsdelivr];
    for (const target of Object.values(manifest.exports)) {
      paths.push(...(typeof target === 'string' ? [target] : Object.values(target)));
    }
    for (const path of paths) expect(existsSync(join(ROOT, path)), path).toBe(true);
    expect(manifest.exports['./iife']).toBe('./dist/vis.iife.js');
  });

  it('writes the reporter token helper as its own entry, with its types and no import', async () => {
    const code = readFileSync(join(DIST, 'reporter-token.js'), 'utf8');
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toContain('node:');
    const built = (await import(pathToFileURL(join(DIST, 'reporter-token.js')).href)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(built).sort()).toEqual([
      'REPORTER_TOKEN_MAX_EXPIRY_SECONDS',
      'signReporterToken',
    ]);
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        p: 'vis-widget-signing',
        o: '01JACME0000000000000000000',
        w: '01JWXDGET00000000000000000',
        n: 2,
      }),
    ).toString('base64url');
    const sign = built['signReporterToken'] as (secret: string) => Promise<string>;
    const token = await sign(`pvs_${payload}.c2ln`);
    expect(token.split('.')).toHaveLength(3);
    expect(readFileSync(join(DIST, 'reporter-token.d.ts'), 'utf8')).toContain('signReporterToken');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports['./reporter-token']).toEqual({
      types: './dist/reporter-token.d.ts',
      default: './dist/reporter-token.js',
    });
  });

  it('loads the replay lazily: the ES module imports its entry, the script-tag file its published script', () => {
    const esm = readFileSync(join(DIST, 'index.js'), 'utf8');
    expect(esm).toMatch(/import\(\s*["']@probara\/vis-capture\/replay["']\s*\)/);
    const iife = readFileSync(IIFE, 'utf8');
    // rrweb is not bundled into the script-tag file.
    expect(iife).not.toContain('rr_dataURLOptions');
    expect(iife).not.toContain('checkoutEveryNms');
    const engine = JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(iife).toContain(
      `https://cdn.jsdelivr.net/npm/@probara/vis-capture@${engine.version}/dist/vis-capture-replay.iife.js`,
    );
  });
});
