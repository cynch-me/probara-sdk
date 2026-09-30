/**
 * The test a `probara.*` call belongs to, read in the test process from Jest's own globals: the
 * test file from expect's state, and the test and its attempt from jest-circus. Loaded inside the
 * test sandbox, it needs nothing but the sandbox's global object.
 *
 * It reads what Jest keeps for itself, not a public API: jest-circus's state under an unregistered
 * `Symbol('JEST_STATE_SYMBOL')` (`currentlyRunningTest`, its describe chain and `invocations`, on
 * Jest 29 and 30), and expect's state (`testPath`; `currentConcurrentTestName()`, and from Jest 30.5
 * `currentTestIdentity()`). jest-circus is Jest's default runner (`testRunner`); under another one
 * (`jest-jasmine2`) no test is found, and {@link runnerProblem} says why.
 *
 * Limits: a `test.concurrent` test retried by `jest.retryTimes` on Jest 30.0 to 30.4 (without
 * `currentTestIdentity()`) is found as attempt 1 when another test is circus's running one, so the
 * lines of its retries join those of its first attempt. A test file that mocks `fs`
 * (`jest.mock('fs')`) mocks the writes of the helpers too: nothing reaches the reporter.
 */

/** A test attempt as the reporter will know it: file, full name and attempt number. */
export interface CurrentTest {
  /** The absolute path of the test file (`test.path` for the reporter). */
  file: string;
  /** The describes and the title joined by spaces: Jest's full name of the test. */
  test: string;
  /** 1 for the first attempt, 2 for the first retry of `jest.retryTimes`... */
  attempt: number;
}

/** What jest-circus keeps of a test or a describe block: its name and parent. */
interface CircusEntry {
  name: string;
  parent?: CircusEntry | undefined;
  invocations?: number;
}

/** The key expect keeps its state under (`expect.getState()`), on Jest 29 and 30. */
const EXPECT_STATE = Symbol.for('$$jest-matchers-object');
/** The description of jest-circus's state symbol, an unregistered `Symbol('JEST_STATE_SYMBOL')`. */
const CIRCUS_STATE = 'JEST_STATE_SYMBOL';

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEntry(value: unknown): value is CircusEntry {
  return isRecord(value) && typeof value.name === 'string';
}

/** The result of an optional getter of expect's state, `undefined` if it is none or throws. */
function call(getter: unknown): unknown {
  if (typeof getter !== 'function') return undefined;
  try {
    return (getter as () => unknown)();
  } catch {
    return undefined;
  }
}

/**
 * Jest's full name of a test: the names of its describe blocks, outermost first, then its own,
 * joined by spaces, without the root block (circus's `getTestID`). With the attempt number, it is
 * the key the reporter finds the test's lines by (`channelKeyOf` in `reporter.ts`, from the
 * `ancestorTitles`, `title` and `invocations` Jest reports): both must stay byte for byte the same,
 * or an attempt silently loses what its helpers said.
 */
function fullNameOf(test: CircusEntry): string {
  const names = [test.name];
  for (let block = test.parent; block?.parent !== undefined; block = block.parent) {
    names.unshift(block.name);
  }
  return names.join(' ');
}

/** 1 for the first attempt, else `invocations`, as the reporter reads Jest's `invocations`. */
function attemptOf(test: CircusEntry): number {
  const { invocations } = test;
  return typeof invocations === 'number' && Number.isInteger(invocations) && invocations > 1
    ? invocations
    : 1;
}

function expectStateOf(global: typeof globalThis): Record<PropertyKey, unknown> | undefined {
  const matchers = (global as unknown as Record<PropertyKey, unknown>)[EXPECT_STATE];
  return isRecord(matchers) && isRecord(matchers.state) ? matchers.state : undefined;
}

function runningTestOf(global: typeof globalThis): CircusEntry | undefined {
  const symbol = Object.getOwnPropertySymbols(global).find(
    (each) => each.description === CIRCUS_STATE,
  );
  const state: unknown =
    symbol === undefined ? undefined : (global as unknown as Record<symbol, unknown>)[symbol];
  const running = isRecord(state) ? state.currentlyRunningTest : undefined;
  return isEntry(running) ? running : undefined;
}

/** The message of the helpers when Jest runs a file with another runner than jest-circus. */
const NOT_CIRCUS =
  "probara.* needs jest-circus, Jest's default test runner: with another testRunner, no call is recorded";

/**
 * Why no test can be found in the sandbox of `global`: Jest runs it (expect's state names its file)
 * without jest-circus (no circus state). `undefined` under jest-circus, or outside Jest. Never
 * throws.
 */
export function runnerProblem(global: typeof globalThis): string | undefined {
  try {
    if (currentTestFile(global) === undefined) return undefined;
    const circus = Object.getOwnPropertySymbols(global).some(
      (each) => each.description === CIRCUS_STATE,
    );
    return circus ? undefined : NOT_CIRCUS;
  } catch {
    return undefined;
  }
}

/** The test file the sandbox of `global` runs, even while no test runs. Never throws. */
export function currentTestFile(global: typeof globalThis): string | undefined {
  try {
    const file = expectStateOf(global)?.testPath;
    return typeof file === 'string' && file !== '' ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The test attempt running now in the sandbox of `global`, or `undefined` outside one (a describe
 * body, `beforeAll`, `afterAll`, the module scope, or not in Jest at all). A test's `beforeEach`
 * and `afterEach` hooks belong to it. Jest 30.5's `currentTestIdentity()` is exact; before it, a
 * `test.concurrent` test is found by its full name (`currentConcurrentTestName()`, which circus's
 * running test gets wrong), with the attempt of the running test when that is the same test, else
 * 1. Never throws.
 */
export function currentTest(global: typeof globalThis): CurrentTest | undefined {
  try {
    const state = expectStateOf(global);
    const file = currentTestFile(global);
    if (state === undefined || file === undefined) return undefined;
    const identity = call(state.currentTestIdentity);
    if (isEntry(identity)) {
      return { file, test: fullNameOf(identity), attempt: attemptOf(identity) };
    }
    const running = runningTestOf(global);
    const concurrent = call(state.currentConcurrentTestName);
    if (typeof concurrent === 'string' && concurrent !== '') {
      const same = running !== undefined && fullNameOf(running) === concurrent;
      return { file, test: concurrent, attempt: same ? attemptOf(running) : 1 };
    }
    return running === undefined
      ? undefined
      : { file, test: fullNameOf(running), attempt: attemptOf(running) };
  } catch {
    return undefined;
  }
}
