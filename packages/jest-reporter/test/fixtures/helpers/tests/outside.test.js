const { probara } = require('@probara/jest-reporter');

// No test runs here, nor in a describe body, beforeAll or afterAll: nothing is attributed.
probara.id('SHOP-99');

describe('outside', () => {
  probara.title('From a describe body');

  beforeAll(() => {
    probara.tags('from-beforeAll');
  });

  afterAll(() => {
    probara.comment('From afterAll');
  });

  test('keeps nothing said outside it', () => {
    probara.tags(42);
  });
});
