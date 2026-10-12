import { describe, expect, it } from 'vitest';

describe('beta', () => {
  it('passes', () => {
    expect(true).toBe(true);
  });

  it.skip('waits for its ticket', () => {
    expect(true).toBe(true);
  });
});
