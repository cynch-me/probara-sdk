import { describe, expect, it } from 'vitest';

describe('alpha', () => {
  it('passes first', () => {
    expect(1 + 1).toBe(2);
  });

  it('fails', () => {
    expect(1 + 1).toBe(3);
  });

  it('is never reached', () => {
    expect(1 + 1).toBe(2);
  });
});
