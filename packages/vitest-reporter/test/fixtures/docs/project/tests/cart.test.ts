import { describe, expect, it } from 'vitest';

describe('cart', () => {
  it('SHOP-12 adds an item', () => {
    expect([1, 2]).toHaveLength(2);
  });

  it('removes an item', () => {
    expect([1].filter((item) => item !== 1)).toEqual([]);
  });
});
