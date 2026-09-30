const { probara } = require('@probara/jest-reporter');

describe('checkout', () => {
  test('links the build and its issues', () => {
    probara
      .link('https://ci.example.com/build/12', 'Build')
      .issue('SHOP 7/b')
      .link('https://example.com/spec');
  });

  test('fails and names its issue', () => {
    probara.issue('SHOP-8');
    expect(1).toBe(2);
  });
});
