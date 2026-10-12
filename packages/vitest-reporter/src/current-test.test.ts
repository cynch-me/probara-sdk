/**
 * The running test the `probara.*` helpers write to, found in a real Vitest worker: the runner
 * extension's store (exact, also for `test.concurrent`) and Vitest's own current test (the fallback,
 * which a concurrent test cannot rely on). No mocks: the tests run inside Vitest's tests.
 */
import { describe, expect, it } from 'vitest';
import { currentTestSlot, type RunningTest } from './current-test-slot.js';
import { enterCurrentTest, installCurrentTest, leaveCurrentTest } from './current-test.js';

installCurrentTest();

/** A running test, as the runner extension hands it over: Vitest's own task, typed as the helpers see it. */
function taskNamed(name: string): RunningTest {
  return { name, file: { filepath: '/work/shop/tests/checkout.test.ts' }, meta: {} };
}

/** Lets other async work run first, so a flow is resumed after the others entered their tests. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe('currentTestSlot', () => {
  it('finds the running test through Vitest itself when no runner extension entered one, and says it is not exact', () => {
    const found = currentTestSlot()?.current();
    expect(found?.test.name).toBe(
      'finds the running test through Vitest itself when no runner extension entered one, and says it is not exact',
    );
    expect(found?.exact).toBe(false);
  });

  it('finds the test a flow entered, also when two flows enter theirs before either resumes', async () => {
    const flow = async (name: string): Promise<string | undefined> => {
      enterCurrentTest(taskNamed(name));
      await settle();
      return currentTestSlot()?.current()?.test.name;
    };
    const [first, second] = await Promise.all([flow('first flow'), flow('second flow')]);
    expect([first, second]).toEqual(['first flow', 'second flow']);
  });

  it('exact for the test a flow entered, and nothing once that test is left, even in the flow that entered it', async () => {
    const task = taskNamed('left test');
    enterCurrentTest(task);
    await settle();
    expect(currentTestSlot()?.current()).toEqual({ test: task, exact: true });
    leaveCurrentTest(task);
    await settle();
    expect(currentTestSlot()?.current()).toBeUndefined();
  });
});
