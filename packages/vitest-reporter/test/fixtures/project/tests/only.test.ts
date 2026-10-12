import { it } from 'vitest';

it.only('runs alone', () => {
  // The only test of this file that runs: its siblings are skipped by Vitest.
});

it('is skipped next to an only', () => {});
