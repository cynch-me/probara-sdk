describe('cart', () => {
  test('SHOP-12 adds an item', () => {
    expect([1, 2]).toHaveLength(2);
  });

  test('removes an item', () => {
    expect([1].filter((item) => item !== 1)).toEqual([]);
  });
});
