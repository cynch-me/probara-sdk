import { describe, expect, it } from 'vitest';

// Fails on its first attempt and passes on its retry: a shard that records the attempts sends both.
let calls = 0;

describe('gamma', () => {
  it('retries until it passes', { retry: 2 }, () => {
    calls += 1;
    expect(calls).toBeGreaterThan(1);
  });
});
