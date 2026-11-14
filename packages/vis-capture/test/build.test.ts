/**
 * The build: ES modules with their types for npm, and one IIFE file for a script tag that sets the
 * global `ProbaraVisCapture`. The test runs the real build, then loads both outputs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as source from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const IIFE = join(DIST, 'vis-capture.iife.js');

beforeAll(() => {
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsdown'), [], { cwd: ROOT, stdio: 'pipe' });
}, 120_000);

describe('the build of @probara/vis-capture', () => {
  it('writes an ES module with the exports of the source, and its types', async () => {
    const built = (await import(pathToFileURL(join(DIST, 'index.js')).href)) as object;
    expect(Object.keys(built).sort()).toEqual(Object.keys(source).sort());
    expect(readFileSync(join(DIST, 'index.d.ts'), 'utf8')).toContain('createConsoleCapture');
  });

  it('writes one script-tag file that sets the ProbaraVisCapture global', () => {
    const code = readFileSync(IIFE, 'utf8');
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    const context: Record<string, unknown> = {};
    context['globalThis'] = context;
    runInNewContext(code, context);
    const global = context['ProbaraVisCapture'] as Record<string, unknown> | undefined;
    expect(Object.keys(global ?? {}).sort()).toEqual(Object.keys(source).sort());
    expect(global?.['VERSION']).toBe(source.VERSION);
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
    expect(manifest.exports['./iife']).toBe('./dist/vis-capture.iife.js');
  });
});
