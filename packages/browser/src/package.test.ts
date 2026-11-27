/**
 * What `@probara/browser` asks of an installing app: the capture engine it shares with Probara Vis
 * as its only dependency. The private error core is bundled in, never a dependency.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as browser from './index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('the @probara/browser package', () => {
  it('depends on the capture engine alone, never on the private error core', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@probara/vis-capture']);
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it('reports its own version', () => {
    expect(browser.VERSION).toBe(manifest.version);
  });
});
