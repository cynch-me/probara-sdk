import { expect, it } from 'vitest';

it('runs under the user runner, which Node could not import', ({ task }) => {
  expect(task.meta.userRunner).toBe(true);
});
