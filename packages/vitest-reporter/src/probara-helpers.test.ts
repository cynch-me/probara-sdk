/**
 * The platform-neutral `probara.*` helpers with a stage that settles later, as a browser's copy does (V10). A copy that
 * settles after its attempt ended cannot reach the report: it is warned about, once, by name, and never dropped silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endAttempt, type ProbaraTaskMeta, type RecordedAttempt } from './attempts.js';
import type { RunningTest } from './current-test-slot.js';
import {
  createProbaraHelpers,
  type HelpersRuntime,
  type Probara,
  type StageOutcome,
} from './probara-helpers.js';

/** A running test with one recorded attempt, as the setup file leaves it while the attempt runs. */
function testWithAttempt(): RunningTest {
  const attempt: RecordedAttempt = {
    repeat: 0,
    retry: 0,
    startedAt: 0,
    startedMs: 0,
    errorsFrom: 0,
  };
  return {
    name: 'checks the cart',
    file: { filepath: '/work/shop/tests/cart.test.ts' },
    meta: { probara: { attempts: [attempt] } satisfies ProbaraTaskMeta },
  };
}

/** The helpers of `test`, with a stage that answers when the test settles it. */
function helpersFor(test: RunningTest): {
  helpers: Probara;
  settle: (outcome: StageOutcome | Error) => Promise<void>;
} {
  let answer: ((value: StageOutcome) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const runtime: HelpersRuntime = {
    active: () => true,
    current: () => ({ test, exact: true }),
    steps: { get: () => undefined, run: (_scope, body) => body() },
    now: () => 0,
    newId: () => '1',
    stage: () =>
      new Promise<StageOutcome>((resolve, reject) => {
        answer = resolve;
        fail = reject;
      }),
  };
  const settle = (outcome: StageOutcome | Error) => {
    if (outcome instanceof Error) fail?.(outcome);
    else answer?.(outcome);
    return Promise.resolve();
  };
  return { helpers: createProbaraHelpers(runtime), settle };
}

/** The lines the attempt of `test` holds: what the reporter sends with it. */
function linesOf(test: RunningTest): unknown[] {
  return (test.meta.probara as ProbaraTaskMeta).attempts?.[0]?.lines ?? [];
}

function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map(([message]) => String(message));
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probara.attach() whose copy settles later (a browser run)', () => {
  it('records the copy on its attempt when the copy settles while the attempt runs', async () => {
    const test = testWithAttempt();
    const { helpers, settle } = helpersFor(test);
    const pending = helpers.attach({ name: 'receipt', path: 'files/receipt.txt' });
    await settle({ staged: { copy: 'c1', source: 'receipt.txt' } });
    await pending;
    expect(linesOf(test)).toEqual([
      expect.objectContaining({ type: 'attachment', name: 'receipt' }),
    ]);
    expect(warnings()).toEqual([]);
  });

  it('warns once, naming the test and saying attach must be awaited, when the copy settles after its attempt ended', async () => {
    const test = testWithAttempt();
    const { helpers, settle } = helpersFor(test);
    const pending = helpers.attach({ name: 'receipt', path: 'files/receipt.txt' });
    endAttempt(test.meta.probara as ProbaraTaskMeta, { perfMs: 10 });
    await settle({ staged: { copy: 'c1', source: 'receipt.txt' } });
    await pending;
    expect(linesOf(test)).toEqual([]);
    expect(warnings()).toEqual([
      expect.stringMatching(/"receipt".*"checks the cart".*Await probara\.attach\(\)/),
    ]);
  });

  it('warns, naming the test, when a copy fails after its attempt ended', async () => {
    const test = testWithAttempt();
    const { helpers, settle } = helpersFor(test);
    const pending = helpers.attach({ name: 'receipt', path: 'files/receipt.txt' });
    endAttempt(test.meta.probara as ProbaraTaskMeta, { perfMs: 10 });
    await settle(new Error('the browser closed'));
    await pending;
    expect(linesOf(test)).toEqual([]);
    expect(warnings()).toEqual([expect.stringContaining('"checks the cart"')]);
  });
});
