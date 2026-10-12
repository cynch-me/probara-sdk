/**
 * The loader of Vite's file rules caches what it found (V-D120): a load that found no Vite is tried again by the next
 * attach, since the project may install its Vite after an earlier attach looked for it; a load that succeeded is kept.
 */
import { describe, expect, it } from 'vitest';
import { loadVite, type ViteModule } from './vite-rules.js';

const vite: ViteModule = {
  resolveConfig: () => Promise.resolve(undefined),
  isFileLoadingAllowed: () => true,
};

describe('loadVite', () => {
  it('tries again after a load that found no Vite, and keeps one that did', async () => {
    let loads = 0;
    const load = (): Promise<ViteModule | undefined> => {
      loads += 1;
      return Promise.resolve(loads === 1 ? undefined : vite);
    };

    expect(await loadVite('/projects/shop', load)).toBeUndefined();
    expect(await loadVite('/projects/shop', load)).toBe(vite);
    expect(await loadVite('/projects/shop', load)).toBe(vite);
    expect(loads).toBe(2);
  });
});
