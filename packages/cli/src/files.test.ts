import { describe, expect, it } from 'vitest';
import { bySiblingNumber, displayPath } from './files.js';

describe('displayPath', () => {
  it('names a file inside the working directory relative to it', () => {
    expect(displayPath('/work/reports/junit.xml', '/work')).toBe('reports/junit.xml');
  });

  it('keeps a name that only starts with two dots relative: it is still inside', () => {
    expect(displayPath('/work/..reports/junit.xml', '/work')).toBe('..reports/junit.xml');
    expect(displayPath('/work/...xml', '/work')).toBe('...xml');
  });

  it('names a file outside the working directory by its absolute path', () => {
    expect(displayPath('/other/junit.xml', '/work')).toBe('/other/junit.xml');
    expect(displayPath('/junit.xml', '/work')).toBe('/junit.xml');
    expect(displayPath('/work', '/work/reports')).toBe('/work');
    expect(displayPath('/work', '/work')).toBe('/work');
  });
});

describe('bySiblingNumber', () => {
  it('puts a results file before its numbered siblings, in the order they were written', () => {
    const files = [
      '/work/probara-results-10.json',
      '/work/probara-results-2.json',
      '/work/shard.json',
      '/work/probara-results.json',
      '/work/probara-results-attachments.json',
    ];

    expect([...files].sort(bySiblingNumber)).toEqual([
      '/work/probara-results.json',
      '/work/probara-results-2.json',
      '/work/probara-results-10.json',
      '/work/probara-results-attachments.json',
      '/work/shard.json',
    ]);
  });
});
