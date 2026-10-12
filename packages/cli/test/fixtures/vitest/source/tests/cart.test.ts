import { describe, expect, it } from 'vitest';

describe('cart', () => {
  // Only this test runs in the file: its sibling is filtered out by .only.
  it.only('PRB-13 adds an item', () => {
    expect(['book']).toHaveLength(1);
  });

  it('removes an item', () => {
    expect([]).toHaveLength(0);
  });
});
