/**
 * The test a `probara.*` call belongs to, read in the test process from Jest's own globals: the
 * test file from expect's state, and the test and its attempt from jest-circus. Loaded inside the
 * test sandbox, it needs nothing but the sandbox's global object.
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
 * joined by spaces, without the root block (circus's `getTestID`).
 */
function fullNameOf(test: CircusEntry): string {
  const names = [test.name];
  for (let block = test.parent; block?.parent !== undefined; block = block.parent) {
    names.unshift(block.name);
  }
  return names.join(' ');
}

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
    const file = state?.testPath;
    if (state === undefined || typeof file !== 'string' || file === '') return undefined;
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
