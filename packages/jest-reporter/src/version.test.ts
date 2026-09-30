import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderVersionModule } from '../scripts/version-module.mts';
import { VERSION } from './version.js';

describe('VERSION', () => {
  it('is the version of the package (run `pnpm --filter @probara/jest-reporter sync-version`)', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(manifest.version);
  });
});

describe('renderVersionModule', () => {
  it('renders a module exporting the version', () => {
    expect(renderVersionModule('1.2.3-beta.1')).toContain("export const VERSION = '1.2.3-beta.1';");
  });

  it('refuses a version that is not semver', () => {
    expect(() => renderVersionModule("1.0'; evil()")).toThrow('is not a semver version');
  });
});
