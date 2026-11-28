import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installProcessHandlers, type ProcessHost } from './process.js';

function fakeHost() {
  const emitter = new EventEmitter();
  const exit = vi.fn<(code: number) => void>();
  const host: ProcessHost = {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    listenerCount: (event) => emitter.listenerCount(event),
    exit,
  };
  return { emitter, host, exit };
}

function hooks() {
  const captured: { error: unknown; mechanism: string; level: string }[] = [];
  const order: string[] = [];
  return {
    captured,
    order,
    hooks: {
      capture(error: unknown, mechanism: { type: string }, level: 'fatal' | 'error') {
        captured.push({ error, mechanism: mechanism.type, level });
        order.push('capture');
      },
      flush: async () => {
        order.push('flush');
        await Promise.resolve();
        return true;
      },
      log: () => undefined,
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the process handlers', () => {
  it('captures an uncaught exception as fatal, flushes, then exits with code 1', async () => {
    const { emitter, host, exit } = fakeHost();
    const { captured, order, hooks: given } = hooks();
    installProcessHandlers(host, given, {
      onUncaughtException: 'exit',
      onUnhandledRejection: 'warn',
    });
    const error = new Error('crash');
    emitter.emit('uncaughtException', error);
    await settle();
    expect(captured).toEqual([{ error, mechanism: 'onuncaughtexception', level: 'fatal' }]);
    expect(order).toEqual(['capture', 'flush']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('leaves the process running when the app listens to uncaught exceptions itself, or keep-alive is set', async () => {
    for (const [mode, ownListener] of [
      ['exit', true],
      ['keep-alive', false],
    ] as const) {
      const { emitter, host, exit } = fakeHost();
      const { captured, hooks: given } = hooks();
      if (ownListener) emitter.on('uncaughtException', () => undefined);
      installProcessHandlers(host, given, {
        onUncaughtException: mode,
        onUnhandledRejection: 'warn',
      });
      emitter.emit('uncaughtException', new Error('crash'));
      await settle();
      expect(captured).toHaveLength(1);
      expect(exit).not.toHaveBeenCalled();
    }
  });

  it('captures unhandled rejections and keeps running in warn mode, exits in strict mode', async () => {
    for (const mode of ['warn', 'strict'] as const) {
      const { emitter, host, exit } = fakeHost();
      const { captured, hooks: given } = hooks();
      installProcessHandlers(host, given, {
        onUncaughtException: 'exit',
        onUnhandledRejection: mode,
      });
      emitter.emit('unhandledRejection', 'nope', Promise.resolve());
      await settle();
      expect(captured).toEqual([
        { error: 'nope', mechanism: 'onunhandledrejection', level: 'error' },
      ]);
      expect(exit.mock.calls).toEqual(mode === 'strict' ? [[1]] : []);
    }
  });

  it('removes its listeners when uninstalled', () => {
    const { host } = fakeHost();
    const uninstall = installProcessHandlers(host, hooks().hooks, {
      onUncaughtException: 'exit',
      onUnhandledRejection: 'warn',
    });
    expect(host.listenerCount('uncaughtException')).toBe(1);
    uninstall();
    expect(host.listenerCount('uncaughtException')).toBe(0);
    expect(host.listenerCount('unhandledRejection')).toBe(0);
  });
});
