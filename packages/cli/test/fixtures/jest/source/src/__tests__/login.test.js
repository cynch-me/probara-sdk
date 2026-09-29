describe('login', () => {
  test('PRB-12 logs in with a valid password', () => {
    expect(1 + 1).toBe(2);
  });

  test('rejects a wrong password', () => {
    expect('denied').toBe('granted');
  });

  test('crashes on an unexpected exception', () => {
    throw new TypeError('Cannot read properties of undefined (reading "token")');
  });

  test.skip('supports SSO (skipped: SSO provider not configured)', () => {
    expect(true).toBe(true);
  });

  describe('session', () => {
    describe('refresh', () => {
      test('renews the token before expiry', () => {
        expect([1, 2]).toHaveLength(2);
      });
    });
  });

  test.each([
    ['alice', 5],
    ['bob', 3],
  ])('username %s has length %i', (name, len) => {
    expect(name).toHaveLength(len);
  });

  test('prints to stdout and stderr', () => {
    console.log('hello from stdout');
    console.error('hello from stderr');
    process.stdout.write('raw stdout line\n');
    process.stderr.write('raw stderr line\n');
  });

  test('accepts café and ñandú', () => {
    expect('café ñandú').toContain('ñandú');
  });
});
