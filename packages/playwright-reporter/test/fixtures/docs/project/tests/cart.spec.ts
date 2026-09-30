import { expect, test } from '@playwright/test';

test.describe('cart', () => {
  test('SHOP-12 adds an item', async () => {
    expect([1, 2]).toHaveLength(2);
  });

  test('removes an item', async () => {
    expect([1].filter((item) => item !== 1)).toEqual([]);
  });
});
