const { probara } = require('@probara/jest-reporter');

describe('format', () => {
  test('pads a price', async () => {
    probara.parameters({ environment: typeof window });
    // Long enough for the runs of both projects to overlap when two workers start them together.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect('5'.padStart(3, '0')).toBe('005');
  });

  test.skip('rounds a price', () => {});
});
