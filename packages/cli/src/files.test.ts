import { describe, expect, it } from 'vitest';
import { displayPath } from './files.js';

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
