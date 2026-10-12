import { expect, it } from 'vitest';

it('runs under the user runner, after the user setup file', ({ task }) => {
  expect(task.meta.userRunner).toBe(true);
  expect(Reflect.get(globalThis, 'probaraUserSetup')).toBe(true);
});
