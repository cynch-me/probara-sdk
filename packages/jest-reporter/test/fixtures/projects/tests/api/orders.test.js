const { probara } = require('@probara/jest-reporter');

describe('orders', () => {
  test('SHOP-41 lists the orders', () => {
    probara.parameters({ environment: typeof window }).comment('From the api project');
  });

  test('refuses a bad order', () => {
    expect(1 + 1).toBe(3);
  });
});
