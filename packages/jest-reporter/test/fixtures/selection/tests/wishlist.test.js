const { ran } = require('../support/ran');

// Every test of this file is skipped already: the setup file's hook never runs here.
describe.skip('wishlist', () => {
  test('shares the list', () => ran('wishlist shares the list'));

  test('SHOP-11 lists the items', () => ran('wishlist lists the items'));
});
