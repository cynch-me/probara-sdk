/**
 * A process that cannot start for lack of file descriptors (EMFILE, ENFILE): Node returns it without
 * stdout or stderr and emits its `error` on the next tick. Both ways the docs tests run a command
 * fail with that error, never with a TypeError nor an uncaught `error` event, and leave no timer.
 */
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawned: FailedChild[] = [];

class FailedChild extends EventEmitter {
  stdout = null;
  stderr = null;
  exitCode = null;
  kill = vi.fn(() => true);
}

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new FailedChild();
    spawned.push(child);
    process.nextTick(() =>
      child.emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' })),
    );
    return child;
  },
}));

afterEach(() => {
  spawned.length = 0;
});

describe('a command that cannot start', () => {
  // Imported in the tests: the mock above builds children of FailedChild, declared above it.
  it('fails runNode with the spawn error, and kills nothing later', async () => {
    const { runNode } = await import('../support/workspace.js');
    await expect(runNode(['x.js'], '/tmp', {}, { timeoutMs: 50 })).rejects.toThrow('spawn EMFILE');
    await delay(100);

    expect(spawned[0]?.kill).not.toHaveBeenCalled();
  });

  it('ends a started jest with the spawn error in its output', async () => {
    const { createWorkspace, JEST_VERSIONS } = await import('../support/workspace.js');
    const workspace = await createWorkspace(JEST_VERSIONS[0]);
    try {
      const running = workspace.startJest(['--watchAll']);
      await running.exited;

      expect(running.output()).toContain('spawn EMFILE');
    } finally {
      await workspace.remove();
    }
  });

  it('fails a watch session with the spawn error', async () => {
    const { watchSession } = await import('./runner.js');
    await expect(
      watchSession({
        dir: '/tmp',
        file: '/tmp/a.test.js',
        args: ['--watchAll'],
        env: {},
        plan: { runs: 2 },
        deadline: Date.now() + 10_000,
      }),
    ).rejects.toThrow('spawn EMFILE');
  });
});
