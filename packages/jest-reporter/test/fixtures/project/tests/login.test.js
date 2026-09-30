describe('login', () => {
  test('SHOP-12 logs in with a valid password', () => {
    expect('secret').toHaveLength(6);
  });

  test('rejects a wrong password', () => {
    expect('wrong').toBe('right');
  });

  test.skip('supports SSO', () => {});

  test.todo('remembers the device');

  test.failing('is a known bug', () => {
    throw new Error('known bug');
  });

  test.failing('was fixed but is still marked as failing', () => {});

  describe('session', () => {
    describe('refresh', () => {
      test('renews the token', () => {});
    });
  });

  test.each([
    ['alice', 5],
    ['bob', 3],
  ])('username %s has length %i', (name, length) => {
    expect(name).toHaveLength(length);
  });
});

test('top-level test outside any describe', () => {});
