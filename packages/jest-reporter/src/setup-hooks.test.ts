/**
 * The setup file in a test process: what it registers in Jest and tells the reporter, from the
 * settings the reporter wrote into the channel, and that it does nothing without the reporter.
 */
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptKey, writeSettings, type RunSelection } from './channel.js';
import { createChannel, type Channel } from './channel-reader.js';
import * as selection from './selection.js';
import { installSetup, type SetupHooks } from './setup-hooks.js';

const FILE = '/work/app/tests/cart.test.js';

/** A sandbox global of `FILE` while "cart pays" runs, and the console the test writes to. */
function sandbox() {
  const printed: unknown[][] = [];
  const console = {
    log: (...args: unknown[]) => printed.push(args),
    error: (...args: unknown[]) => printed.push(args),
  };
  const root = { name: 'ROOT_DESCRIBE_BLOCK' };
  const pays = { name: 'pays', parent: { name: 'cart', parent: root }, invocations: 1 };
  const global = {
    console,
    [Symbol.for('$$jest-matchers-object')]: {
      state: { testPath: FILE, currentTestIdentity: () => pays },
    },
  } as unknown as typeof globalThis;
  return { global, console, printed };
}

/** Jest's root hooks, as a setup file registers them. */
function fakeHooks() {
  const registered: {
    beforeAll: (() => void)[];
    beforeEach: (() => void)[];
    afterEach: (() => void)[];
  } = { beforeAll: [], beforeEach: [], afterEach: [] };
  const hooks: SetupHooks = {
    beforeAll: (fn) => registered.beforeAll.push(fn),
    beforeEach: (fn) => registered.beforeEach.push(fn),
    afterEach: (fn) => registered.afterEach.push(fn),
  };
  return { hooks, registered };
}

/** jest-circus's collected tests of `FILE` in the sandbox `global`: `cart` › `adds`, `pays`. */
function collect(global: typeof globalThis) {
  const root = { type: 'describeBlock', name: 'ROOT_DESCRIBE_BLOCK', children: [] as unknown[] };
  const cart = { type: 'describeBlock', name: 'cart', parent: root, children: [] as unknown[] };
  root.children.push(cart);
  const adds: { mode?: string } = { type: 'test', name: 'adds', parent: cart } as never;
  const pays: { mode?: string } = { type: 'test', name: 'pays', parent: cart } as never;
  cart.children.push(adds, pays);
  Object.assign(global, { [Symbol('JEST_STATE_SYMBOL')]: { rootDescribeBlock: root } });
  return { adds, pays };
}

const SELECTION: RunSelection = {
  run: '01K00000000000000000000RUN',
  keys: ['tests/cart.test.js > cart pays'],
  caseIds: [],
  projectCodes: ['SHOP'],
  keyIncludesFile: true,
  rootDir: '/work/app',
};

let channel: Channel;

beforeEach(() => {
  channel = createChannel(() => undefined);
});

afterEach(() => {
  channel.close();
});

describe('installSetup', () => {
  it('does nothing without the reporter: no hook, nothing written', () => {
    const { global } = sandbox();
    const { hooks, registered } = fakeHooks();
    installSetup({ global, hooks, channel: () => undefined });
    expect(registered).toEqual({ beforeAll: [], beforeEach: [], afterEach: [] });
    expect(readdirSync(channel.dir)).toEqual(['files']);
  });

  it('tells the reporter it runs in the test file, and registers no hook with every feature off', () => {
    const { global } = sandbox();
    const { hooks, registered } = fakeHooks();
    writeSettings(channel.dir, { captureOutput: false });
    installSetup({ global, hooks, channel: () => channel.dir });
    expect(channel.hasSetup(FILE)).toBe(true);
    expect(registered).toEqual({ beforeAll: [], beforeEach: [], afterEach: [] });
  });

  it("captures each test's console output around it with captureOutput", () => {
    const { global, console, printed } = sandbox();
    const { hooks, registered } = fakeHooks();
    writeSettings(channel.dir, { captureOutput: true });
    installSetup({ global, hooks, channel: () => channel.dir });
    expect(registered.beforeEach).toHaveLength(1);
    expect(registered.afterEach).toHaveLength(1);

    for (const hook of registered.beforeEach) hook();
    console.log('Opening the cart');
    for (const hook of registered.afterEach) hook();

    expect(printed).toEqual([['Opening the cart']]);
    const details = channel.take(FILE).get(attemptKey(FILE, 'cart pays', 1));
    expect(details?.attachments.map(({ name, contentType }) => ({ name, contentType }))).toEqual([
      { name: 'stdout.log', contentType: 'text/plain' },
    ]);
  });

  it('skips the tests that match no case of the run from a root beforeAll, and names them to the reporter', () => {
    const { global } = sandbox();
    const { adds, pays } = collect(global);
    const { hooks, registered } = fakeHooks();
    writeSettings(channel.dir, { captureOutput: false, selection: SELECTION });
    installSetup({ global, hooks, channel: () => channel.dir, selection: () => selection });
    expect(registered.beforeAll).toHaveLength(1);
    expect(registered.beforeEach).toEqual([]);
    // Jest collects the tests of the file after the setup file ran.
    expect(channel.deselected(FILE).size).toBe(0);

    for (const hook of registered.beforeAll) hook();

    expect([adds.mode, pays.mode]).toEqual(['skip', undefined]);
    expect([...channel.deselected(FILE)]).toEqual([JSON.stringify([FILE, 'cart', 'adds'])]);
    expect(channel.deselected('/work/app/tests/other.test.js').size).toBe(0);
  });

  it('selects nothing without a selection in the settings, or where it cannot register a beforeAll', () => {
    const { global } = sandbox();
    const { adds } = collect(global);
    const { hooks, registered } = fakeHooks();
    writeSettings(channel.dir, { captureOutput: false });
    installSetup({ global, hooks, channel: () => channel.dir, selection: () => selection });
    expect(registered.beforeAll).toEqual([]);

    writeSettings(channel.dir, { captureOutput: false, selection: SELECTION });
    const { beforeEach, afterEach } = hooks;
    expect(() => {
      installSetup({
        global,
        hooks: { beforeEach, afterEach },
        channel: () => channel.dir,
        selection: () => selection,
      });
    }).not.toThrow();
    expect(adds.mode).toBeUndefined();
  });

  it('never throws into Jest, even without hooks to register', () => {
    const { global } = sandbox();
    writeSettings(channel.dir, { captureOutput: true });
    expect(() => {
      installSetup({ global, hooks: undefined, channel: () => channel.dir });
    }).not.toThrow();
    expect(() => {
      installSetup({ global, hooks: undefined, channel: () => '/no/such/channel' });
    }).not.toThrow();
  });
});
