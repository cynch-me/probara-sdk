/**
 * What `@probara/node` asks of an installing app: nothing. The private error core is bundled in,
 * never a dependency.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as node from './index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('the @probara/node package', () => {
  it('has no runtime dependencies, never the private error core', () => {
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it('reports its own version', () => {
    expect(node.VERSION).toBe(manifest.version);
  });
});
