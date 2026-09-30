// A test file of a project without Jest's globals (injectGlobals: false): it imports them.
const { describe, test } = require('@jest/globals');
const { ran } = require('../support/ran');

describe('explicit', () => {
  test('adds an item', () => ran('explicit adds an item'));

  test('SHOP-5 removes an item', () => ran('explicit removes an item'));

  test('empties the cart', () => ran('explicit empties the cart'));
});
