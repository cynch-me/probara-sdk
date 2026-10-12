import { describe, expect, it, test } from 'vitest';

let attempts = 0;

describe('checkout', () => {
  it('PRB-12 accepts café and ñandú', () => {
    console.log('stdout from the checkout test');
    console.error('stderr from the checkout test');
    expect(1 + 1).toBe(2);
  });

  it('rejects a wrong coupon', () => {
    expect('expired').toBe('valid');
  });

  it('crashes on an unexpected exception', () => {
    const order = undefined as unknown as { total: number };
    expect(order.total).toBe(0);
  });

  it.skip('supports SSO', () => {
    expect(true).toBe(true);
  });

  describe('session', () => {
    it('renews the token before expiry', () => {
      expect(true).toBe(true);
    });

    describe('expired', () => {
      it.todo('signs the user out');
    });
  });

  test.each([
    ['alice', 5],
    ['bob', 3],
  ])('username %s has length %i', (username, length) => {
    expect(username).toHaveLength(length);
  });

  test.fails('still rejects a known bad coupon', () => {
    expect('valid').toBe('expired');
  });

  test.fails('expected to fail, but passes', () => {
    expect(1).toBe(1);
  });

  it('collects every soft failure', () => {
    expect.soft(1).toBe(2);
    expect.soft('a').toBe('b');
  });

  it('passes on its third attempt', { retry: 2 }, () => {
    attempts += 1;
    expect(attempts).toBe(3);
  });

  it('fails on every attempt', { retry: 2 }, () => {
    expect('retried').toBe('passed');
  });
});
