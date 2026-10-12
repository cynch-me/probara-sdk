import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('session', () => {
  beforeAll(() => {
    throw new Error('the seed data is missing');
  });

  it('renews the token before expiry', () => {
    expect(true).toBe(true);
  });
});

describe('teardown', () => {
  afterAll(() => {
    throw new Error('the cleanup failed');
  });

  it('passes before its afterAll fails', () => {
    expect(true).toBe(true);
  });
});

describe('cart', () => {
  it('adds an item', () => {
    expect(1).toBe(1);
  });
});
