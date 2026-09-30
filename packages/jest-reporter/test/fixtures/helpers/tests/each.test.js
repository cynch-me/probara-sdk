const { probara } = require('@probara/jest-reporter');

describe('cards', () => {
  test.each(['visa', 'amex'])('pays with %s', (card) => {
    probara.parameters({ card });
  });
});
