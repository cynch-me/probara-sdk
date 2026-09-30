import { describe, expect, it } from 'vitest';
import { isVersionAtLeast } from './version.js';

describe('isVersionAtLeast', () => {
  it('compares the major and minor versions as integers, not as a decimal', () => {
    expect(isVersionAtLeast('1.100.0', 1, 51)).toBe(true);
    expect(isVersionAtLeast('1.42.1', 1, 51)).toBe(false);
    expect(isVersionAtLeast('1.51.0', 1, 51)).toBe(true);
    expect(isVersionAtLeast('2.0.0', 1, 51)).toBe(true);
    expect(isVersionAtLeast('0.99.0', 1, 0)).toBe(false);
  });
});
