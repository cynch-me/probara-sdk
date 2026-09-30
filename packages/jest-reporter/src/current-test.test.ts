/**
 * The running test as a helper reads it from Jest's globals, shaped like what jest-circus 29.7 and
 * 30.5 keep there (see the spike notes in the feature document): the circus state under an
 * unregistered `JEST_STATE_SYMBOL`, and expect's state under `$$jest-matchers-object`.
 */
import { describe, expect, it } from 'vitest';
import { currentTest, currentTestFile } from './current-test.js';

const FILE = '/work/app/tests/cart.test.js';

interface Block {
  name: string;
  parent?: Block;
}

const root: Block = { name: 'ROOT_DESCRIBE_BLOCK' };
const cart: Block = { name: 'cart', parent: root };
const totals: Block = { name: 'totals', parent: cart };

function testIn(parent: Block, name: string, invocations = 1) {
  return { type: 'test', name, parent, invocations };
}

/** A sandbox global of a test file, with the parts of Jest's state a helper reads. */
interface Sandbox {
  running?: unknown;
  expectState?: Record<string, unknown>;
  path?: string | null;
}

function sandbox({
  running = null,
  expectState = {},
  path = FILE,
}: Sandbox = {}): typeof globalThis {
  const global: Record<PropertyKey, unknown> = {};
  global[Symbol('JEST_STATE_SYMBOL')] = { currentlyRunningTest: running };
  global[Symbol.for('$$jest-matchers-object')] = {
    state: { ...(path === null ? {} : { testPath: path }), ...expectState },
  };
  return global as typeof globalThis;
}

describe('currentTest', () => {
  it('names the running test by its describes and title, with its attempt', () => {
    expect(currentTest(sandbox({ running: testIn(totals, 'adds taxes', 2) }))).toEqual({
      file: FILE,
      test: 'cart totals adds taxes',
      attempt: 2,
    });
    expect(currentTest(sandbox({ running: testIn(root, 'top-level test') }))).toEqual({
      file: FILE,
      test: 'top-level test',
      attempt: 1,
    });
  });

  it('finds no test outside a test: in a describe body, beforeAll, afterAll or module scope', () => {
    expect(currentTest(sandbox())).toBeUndefined();
    expect(currentTestFile(sandbox())).toBe(FILE);
    expect(currentTestFile({} as typeof globalThis)).toBeUndefined();
    expect(currentTest({} as typeof globalThis)).toBeUndefined();
    expect(currentTest(sandbox({ running: testIn(cart, 'x'), path: null }))).toBeUndefined();
  });

  it('prefers the concurrent test of the async context, which circus does not track', () => {
    const state = sandbox({
      running: testIn(cart, 'another concurrent test'),
      expectState: { currentConcurrentTestName: () => 'cart pays by card' },
    });
    expect(currentTest(state)).toEqual({ file: FILE, test: 'cart pays by card', attempt: 1 });
  });

  it("takes the attempt of the running test when it is the concurrent one (Jest 30's retries)", () => {
    const state = sandbox({
      running: testIn(cart, 'pays by card', 3),
      expectState: { currentConcurrentTestName: () => 'cart pays by card' },
    });
    expect(currentTest(state)).toEqual({ file: FILE, test: 'cart pays by card', attempt: 3 });
  });

  it('falls back to the running test outside a concurrent test', () => {
    const state = sandbox({
      running: testIn(totals, 'adds taxes'),
      expectState: { currentConcurrentTestName: () => undefined },
    });
    expect(currentTest(state)?.test).toBe('cart totals adds taxes');
  });

  it("trusts Jest 30.5's test identity over everything else", () => {
    const state = sandbox({
      running: testIn(cart, 'another test'),
      expectState: {
        currentConcurrentTestName: () => 'cart another test',
        currentTestIdentity: () => testIn(totals, 'rounds', 2),
      },
    });
    expect(currentTest(state)).toEqual({ file: FILE, test: 'cart totals rounds', attempt: 2 });
  });

  it('never throws, whatever the globals hold', () => {
    const state = sandbox({
      running: { name: 42 },
      expectState: {
        currentConcurrentTestName: () => {
          throw new Error('boom');
        },
        currentTestIdentity: 'not a function',
      },
    });
    expect(currentTest(state)).toBeUndefined();
  });
});
