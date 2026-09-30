/**
 * The setup file in a test process: what it registers in Jest and tells the reporter, from the
 * settings the reporter wrote into the channel, and that it does nothing without the reporter.
 */
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptKey, writeSettings } from './channel.js';
import { createChannel, type Channel } from './channel-reader.js';
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
  const registered: { beforeEach: (() => void)[]; afterEach: (() => void)[] } = {
    beforeEach: [],
    afterEach: [],
  };
  const hooks: SetupHooks = {
    beforeEach: (fn) => registered.beforeEach.push(fn),
    afterEach: (fn) => registered.afterEach.push(fn),
  };
  return { hooks, registered };
}

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
    expect(registered).toEqual({ beforeEach: [], afterEach: [] });
    expect(readdirSync(channel.dir)).toEqual(['files']);
  });

  it('tells the reporter it runs in the test file, and registers no hook with every feature off', () => {
    const { global } = sandbox();
    const { hooks, registered } = fakeHooks();
    writeSettings(channel.dir, { captureOutput: false });
    installSetup({ global, hooks, channel: () => channel.dir });
    expect(channel.hasSetup(FILE)).toBe(true);
    expect(registered).toEqual({ beforeEach: [], afterEach: [] });
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
