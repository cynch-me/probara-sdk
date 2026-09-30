/** The docs harness's reading of the command lines of a CI job. */
import { describe, expect, it } from 'vitest';
import { importResultsPaths } from './jobs.js';

describe('importResultsPaths', () => {
  it('takes every path and glob, wherever the flags are', () => {
    expect(
      importResultsPaths([
        'a.json',
        '--dry-run',
        'shard-*.json',
        '--max-retries',
        '0',
        'b.json',
        '--run-name=Nightly',
        '--json',
        'c.json',
      ]),
    ).toEqual(['a.json', 'shard-*.json', 'b.json', 'c.json']);
  });

  it('leaves out the values of the flags that take one, by the registry of the CLI', () => {
    expect(
      importResultsPaths([
        '--project',
        'SHOP',
        '--tag',
        'smoke',
        '--debug',
        'probara-results*.json',
      ]),
    ).toEqual(['probara-results*.json']);
    expect(importResultsPaths(['--', '--odd-name.json'])).toEqual(['--odd-name.json']);
  });
});
