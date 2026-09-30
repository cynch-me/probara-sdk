const { ran } = require('../support/ran');

describe('search', () => {
  test('finds an item', () => ran('search finds an item'));

  test('finds nothing', () => ran('search finds nothing'));
});
