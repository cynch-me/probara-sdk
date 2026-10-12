/**
 * The running test of each async flow of a Vitest worker, for the `probara.*` helpers (V-D7). The
 * runner extension enters each test in an AsyncLocalStorage store before its body runs, so a flow of a
 * concurrent test finds its own test. The store and the running set live on `globalThis`, once per
 * worker, so every copy of this package shares them. Without the runner extension (not registered, or a
 * user runner Node cannot import), the fallback is Vitest's own current test: right for a sequential
 * test, never for a concurrent one, which the helpers then drop with a warning.
 *
 * Worker side only: this module imports Vitest. The reporter process never loads it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import * as vitest from 'vitest';
import {
  CURRENT_TEST_SLOT,
  type CurrentTest,
  type CurrentTestSlot,
  type RunningTest,
} from './current-test-slot.js';

/** The subpath that exports Vitest's current test before 4.1; a variable, as in `runner.ts`. */
const SUITE_SUBPATH = 'vitest/suite';

/** The state every copy of this module in a worker shares. */
interface Holder {
  readonly storage: AsyncLocalStorage<RunningTest>;
  /** The tests the runner extension entered and has not left. */
  readonly running: Set<RunningTest>;
}

const HOLDER = Symbol.for('@probara/vitest-reporter/current-test/holder/v1');

function isHolder(value: unknown): value is Holder {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'storage') instanceof AsyncLocalStorage &&
    Reflect.get(value, 'running') instanceof Set
  );
}

function holderOf(): Holder {
  const existing: unknown = Reflect.get(globalThis, HOLDER);
  if (isHolder(existing)) return existing;
  const created: Holder = {
    storage: new AsyncLocalStorage<RunningTest>(),
    running: new Set<RunningTest>(),
  };
  Reflect.set(globalThis, HOLDER, created);
  return created;
}

/** Vitest's own current test, which its runner sets while a test runs and clears after it. */
type GlobalCurrent = () => RunningTest | undefined;

async function globalCurrentOf(): Promise<GlobalCurrent> {
  if ('TestRunner' in vitest) {
    return () => vitest.TestRunner.getCurrentTest() as RunningTest | undefined;
  }
  const suite = (await import(SUITE_SUBPATH)) as { getCurrentTest: GlobalCurrent };
  return suite.getCurrentTest;
}

const globalCurrent = await globalCurrentOf();

/**
 * Installs the slot of this worker, which the `probara.*` helpers read. Idempotent: the runner
 * extension and the setup file both call it, and whichever runs first creates the shared state.
 */
export function installCurrentTest(): void {
  const { storage, running } = holderOf();
  const slot: CurrentTestSlot = {
    current(): CurrentTest | undefined {
      const entered = storage.getStore();
      if (entered !== undefined) {
        return running.has(entered) ? { test: entered, exact: true } : undefined;
      }
      const test = globalCurrent();
      return test === undefined ? undefined : { test, exact: false };
    },
  };
  Reflect.set(globalThis, CURRENT_TEST_SLOT, slot);
}

/** Enters a test before its body runs: the async flows of the test find it from now on. */
export function enterCurrentTest(test: RunningTest): void {
  const { storage, running } = holderOf();
  running.add(test);
  storage.enterWith(test);
}

/** Leaves a test once it ended: no flow finds it any more, even one that entered it. */
export function leaveCurrentTest(test: RunningTest): void {
  holderOf().running.delete(test);
}
