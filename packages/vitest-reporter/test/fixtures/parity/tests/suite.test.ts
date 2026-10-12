import { describe, expect, it, test } from 'vitest';

describe('checkout', () => {
  it('SHOP-12 accepts café and ñandú', () => {
    expect('café ñandú').toBe('café ñandú');
  });

  it('rejects a wrong coupon', () => {
    expect('WRONG').toBe('RIGHT');
  });

  it.skip('supports SSO', () => {
    expect(true).toBe(true);
  });

  it.todo('remembers the device');

  it.fails('is a known bug', () => {
    throw new Error('the bug is still there');
  });

  it.fails('was fixed but is still marked as failing', () => {
    expect(1).toBe(1);
  });

  it('collects every soft failure', () => {
    expect.soft(1).toBe(2);
    expect.soft('a').toBe('b');
  });

  it.each(['alice', 'bob'])('username %s is accepted', (name) => {
    expect(name.length).toBeGreaterThan(0);
  });

  test.for([1, 2])('number %i doubles', (value, { expect: check }) => {
    check(value * 2).toBe(value + value);
  });

  it.skipIf(true)('skipped by a condition', () => {
    expect(true).toBe(true);
  });

  it.runIf(false)('runs only elsewhere', () => {
    expect(true).toBe(true);
  });

  it('keeps a > in its title', () => {
    expect(1 + 1).toBe(2);
  });

  describe('session', () => {
    it('WEB-7 renews the token before expiry', () => {
      expect(1 + 1).toBe(2);
    });
  });
});
