import { expect, it } from 'vitest';

it('never runs, because its user runner throws when it loads', () => {
  expect(true).toBe(true);
});
