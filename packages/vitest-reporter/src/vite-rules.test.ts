/**
 * Vite's file rules (V-D119, V-D120). The fakes follow the contracts the probes read from the real packages: Vite 6
 * checks a resolved configuration (`isFileLoadingAllowed(config, file)`); Vite 5.4 checks the server, which reads its
 * configuration from `server.config` (a configuration throws there); Vite 5.0 to 5.3 export only
 * `isFileServingAllowed(url, server)`.
 */
import { describe, expect, it } from 'vitest';
import { fileRulesOf, loadVite, type ViteModule } from './vite-rules.js';

/** The part of a resolved configuration the fakes read: the folders Vite serves. */
interface Resolved {
  readonly server: { readonly fs: { readonly allow: readonly string[] } };
}

/** A server as Vite 5 hands it to its checks: its resolved configuration. */
interface Server {
  readonly config: Resolved;
}

const resolved: Resolved = { server: { fs: { allow: ['/projects/shop'] } } };

function servedIn(fs: Resolved['server']['fs'], file: string): boolean {
  return fs.allow.some((dir) => file.startsWith(dir));
}

const resolve = () => Promise.resolve(undefined);

const vite6: ViteModule = {
  version: '6.4.4',
  resolveConfig: resolve,
  isFileLoadingAllowed: (config, file) => servedIn((config as Resolved).server.fs, file),
};

const vite54: ViteModule = {
  version: '5.4.21',
  resolveConfig: resolve,
  isFileLoadingAllowed: (server, file) => servedIn((server as Server).config.server.fs, file),
};

const vite50: ViteModule = {
  version: '5.0.0',
  resolveConfig: resolve,
  isFileServingAllowed: (url, server) => servedIn((server as Server).config.server.fs, url),
};

const vite40: ViteModule = { version: '4.5.0', resolveConfig: resolve };

describe('loadVite', () => {
  it('tries again after a load that found no Vite, and keeps one that did', async () => {
    let loads = 0;
    const load = (): Promise<ViteModule | undefined> => {
      loads += 1;
      return Promise.resolve(loads === 1 ? undefined : vite6);
    };

    expect(await loadVite('/projects/shop', load)).toBeUndefined();
    expect(await loadVite('/projects/shop', load)).toBe(vite6);
    expect(await loadVite('/projects/shop', load)).toBe(vite6);
    expect(loads).toBe(2);
  });
});

describe('fileRulesOf', () => {
  it('checks the resolved configuration on Vite 6, which takes one', () => {
    const check = fileRulesOf(vite6).check;

    expect(check?.({ config: resolved }, '/projects/shop/receipt.txt')).toBe(true);
    expect(check?.({ config: resolved }, '/etc/passwd')).toBe(false);
  });

  it('checks the server on Vite 5.4, which reads its configuration from the server', () => {
    const check = fileRulesOf(vite54).check;

    expect(check?.({ config: resolved }, '/projects/shop/receipt.txt')).toBe(true);
    expect(check?.({ config: resolved }, '/etc/passwd')).toBe(false);
  });

  it("follows Vite 5.0's isFileServingAllowed, with a notice, when it is the only check", () => {
    const rules = fileRulesOf(vite50);

    expect(rules.check?.({ config: resolved }, '/projects/shop/receipt.txt')).toBe(true);
    expect(rules.notice).toMatch(/isFileServingAllowed/);
  });

  it('gives no check, and a notice, when Vite exports neither file check', () => {
    const rules = fileRulesOf(vite40);

    expect(rules.check).toBeUndefined();
    expect(rules.notice).toMatch(/neither/);
  });
});
