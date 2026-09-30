const { ran } = require('../support/ran');

describe('cart', () => {
  test('adds an item', () => ran('cart adds an item'));

  test('SHOP-5 removes an item', () => ran('cart removes an item'));

  test('empties the cart', () => ran('cart empties the cart'));

  test.each([['visa'], ['amex']])('pays with %s', (card) => ran(`cart pays with ${card}`));

  test.concurrent('checks the stock', async () => ran('cart checks the stock'));

  // jest-junit names it "cart costs {title} more": `$&` is the tag it replaces.
  test('costs $& more', () => ran('cart costs more'));

  test.todo('saves it for later');
});

describe('SHOP-9 checkout', () => {
  test('pays', () => ran('checkout pays'));

  test.concurrent('sends the receipt', async () => ran('checkout sends the receipt'));
});
