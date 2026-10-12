import { expect, it } from 'vitest';

// Fails its first attempt, then passes: a passing retry has no failure in Vitest's JUnit output.
let attempts = 0;
it('passes on its retry', { retry: 1 }, () => {
  attempts += 1;
  expect(attempts).toBe(2);
});

// Fails on every attempt: Vitest's JUnit output has one failure per attempt.
it('fails on every attempt', { retry: 2 }, () => {
  expect(1).toBe(2);
});
