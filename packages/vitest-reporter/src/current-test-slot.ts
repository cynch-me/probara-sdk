/**
 * The worker-side handle on the running test, which the runner extension and the setup file install
 * and the `probara.*` helpers read. It lives on `globalThis` under a `Symbol.for` key, so every copy of
 * this package in a worker finds the same one. This module loads nothing: the helpers, which the
 * reporter process loads too, never import Vitest (V-D1, V-D7).
 */

/** The part of a running Vitest test the helpers use. */
export interface RunningTest {
  readonly name: string;
  readonly file?: { readonly filepath: string } | undefined;
  /** Vitest's `task.meta`: the helpers write their `probara` entry here, the reporter reads it. */
  meta: Record<string, unknown>;
  /** `test.concurrent`: the test runs alongside others of its file. */
  readonly concurrent?: boolean | undefined;
  /** Vitest's result of the test: its repeat and retry count say which try is running (V-D71). */
  result?: { repeatCount?: number | undefined; retryCount?: number | undefined } | undefined;
  /** Vitest's test context: `annotate` records a file while the test body runs (`probara.attach()`). */
  readonly context?: { readonly annotate?: unknown } | undefined;
}

/** The test the helpers write to. */
export interface CurrentTest {
  readonly test: RunningTest;
  /**
   * Found through the runner extension's store, which follows each async flow: exact, also when the
   * test runs concurrently. Otherwise it is Vitest's own current test, which a concurrent test cannot
   * rely on.
   */
  readonly exact: boolean;
}

/** What the helpers read: the running test, or `undefined` outside any test or when none can be found. */
export interface CurrentTestSlot {
  current(): CurrentTest | undefined;
}

/** The key the slot lives under on `globalThis`. */
export const CURRENT_TEST_SLOT = Symbol.for('@probara/vitest-reporter/current-test/v1');

/** The slot of this worker, or `undefined` while nothing installed one: no reporter runs here. */
export function currentTestSlot(): CurrentTestSlot | undefined {
  const slot: unknown = Reflect.get(globalThis, CURRENT_TEST_SLOT);
  return isSlot(slot) ? slot : undefined;
}

function isSlot(value: unknown): value is CurrentTestSlot {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'current') === 'function'
  );
}
