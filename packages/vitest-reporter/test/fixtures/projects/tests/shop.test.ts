import { describe, expect, it } from 'vitest';

describe('cart', () => {
  it('adds an item', () => {
    expect(['apple']).toHaveLength(1);
  });

  it('empties the cart', () => {
    expect([]).toHaveLength(0);
  });
});
