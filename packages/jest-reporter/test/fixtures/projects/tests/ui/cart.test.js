const { probara } = require('@probara/jest-reporter');

describe('cart', () => {
  test('SHOP-42 shows the total', () => {
    document.body.innerHTML = '<p>Total: 5</p>';
    probara.parameters({ environment: typeof window }).comment('From the ui project');
  });
});
