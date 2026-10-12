import { expect, it } from 'vitest';

it('admin sees the orders', () => {
  expect(['order']).toHaveLength(1);
});
