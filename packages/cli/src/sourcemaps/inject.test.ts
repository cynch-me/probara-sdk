import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { inject, snippetOf } from './inject.js';

const DEBUG_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const MAP = { version: 3, sources: ['app.ts'], names: [], mappings: 'AAAA,IAAI' };
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function firstColumn(mappings: unknown): number {
  let result = 0;
  let shift = 0;
  for (const char of String(mappings)) {
    const digit = BASE64.indexOf(char);
    result += (digit & 31) * 2 ** shift;
    shift += 5;
    if ((digit & 32) === 0) break;
  }
  return result % 2 === 1 ? -Math.floor(result / 2) : result / 2;
}

function run(code: string): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(code, sandbox);
  return sandbox;
}

describe('inject', () => {
  it('registers the release the build was made for beside the debug ID, and shifts the map by the whole snippet', () => {
    const release = 'shop@1.4.2 "quoted" \\ </script>';
    const { code, map } = inject('var a=1;', { ...MAP }, DEBUG_ID, release);
    const scope = run(code);
    expect(scope.PROBARA_RELEASE).toEqual({ id: release });
    expect(Object.values(scope._probaraDebugIds as Record<string, string>)).toEqual([DEBUG_ID]);
    const snippet = snippetOf(DEBUG_ID, release);
    expect(code).toBe(`${snippet}var a=1;\n//# debugId=${DEBUG_ID}\n`);
    expect(map.debug_id).toBe(DEBUG_ID);
    expect(firstColumn(map.mappings)).toBe(snippet.length);
  });

  it('registers no release without one, as probara sourcemaps inject does', () => {
    const { code, map } = inject('var a=1;', { ...MAP }, DEBUG_ID);
    const scope = run(code);
    expect(scope).not.toHaveProperty('PROBARA_RELEASE');
    expect(code).toBe(`${snippetOf(DEBUG_ID)}var a=1;\n//# debugId=${DEBUG_ID}\n`);
    expect(firstColumn(map.mappings)).toBe(snippetOf(DEBUG_ID).length);
  });
});
