import { describe, expect, it } from 'vitest';

describe('alpha', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2);
  });

  it('fails', () => {
    expect(1 + 1).toBe(3);
  });
});
