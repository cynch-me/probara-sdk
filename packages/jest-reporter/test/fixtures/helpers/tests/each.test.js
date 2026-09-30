const { probara } = require('@probara/jest-reporter');

describe('cards', () => {
  test.each(['visa', 'amex'])('pays with %s', (card) => {
    probara.parameters({ card });
  });

  // No placeholder: both rows have the same full name, so their helper lines the same key.
  test.each(['visa', 'amex'])('pays with a card of the row', (card) => {
    probara.parameters({ card });
  });
});
