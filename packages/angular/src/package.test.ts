/**
 * What `@probara/angular` asks of an installing app: `@probara/browser` as its only dependency,
 * and the Angular packages and RxJS the app already runs as peers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('the @probara/angular package', () => {
  it('depends on @probara/browser alone, with Angular and RxJS as peers', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@probara/browser']);
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual([
      '@angular/common',
      '@angular/core',
      '@angular/router',
      'rxjs',
    ]);
  });

  it('reports its own version, not the browser SDK one', () => {
    expect(VERSION).toBe(manifest.version);
  });
});
