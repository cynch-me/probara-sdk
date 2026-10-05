/**
 * The end of a run: Cypress takes the process that runs `setupNodeEvents` apart the moment it
 * answers `after:run`, and the last thing that process writes is the run's own summary.
 */
import { describe, expect, it } from 'vitest';
import { until } from '../test/support/wait.js';
import { flushRunOutput, type FlushableStream } from './run.js';

/** A promise that takes `ms`; the tests of a wait have to let time pass. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The stream a run logs on, with the `drain` the test decides when: what it is waiting for. */
function fakeStream(pending: number): {
  stream: FlushableStream;
  /** How many `drain` listeners the stream holds, so a test can see it is waiting for one. */
  waiting(): number;
  /** What the process reading the stream did with the bytes. */
  drained(): void;
} {
  let length = pending;
  const listeners = new Set<() => void>();
  const stream: FlushableStream = {
    get writableLength() {
      return length;
    },
    once(_event, listener) {
      listeners.add(listener);
      return stream;
    },
    off(_event, listener) {
      listeners.delete(listener);
      return stream;
    },
  };
  return {
    stream,
    waiting: () => listeners.size,
    drained: () => {
      length = 0;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('the end of a run, before Cypress takes the plugin process apart', () => {
  it('waits until the run has nothing pending on the stream it logs on', async () => {
    // The run's last lines are written a moment before the run ends; the wait ends with them, not
    // before whatever carries them out of this process has taken them.
    const output = fakeStream(64);
    const flushed = flushRunOutput(output.stream, { graceMs: 0 });
    let ended = false;
    void flushed.then(() => {
      ended = true;
    });
    await until(() => output.waiting() === 1, 'the end of the run to wait for the drain');
    expect(ended).toBe(false);
    output.drained();
    await flushed;
    expect(ended).toBe(true);
    expect(output.waiting()).toBe(0);
  });

  it('does not wait for a drain of a stream that has nothing pending', async () => {
    // Every line of the run is already in the pipe: there is nothing to wait for but the reader.
    const output = fakeStream(0);
    await flushRunOutput(output.stream, { graceMs: 0 });
    expect(output.waiting()).toBe(0);
  });

  it('ends the run even when the stream never drains', async () => {
    // A reader that never takes the bytes must not hold the end of a run hostage.
    const output = fakeStream(1);
    await flushRunOutput(output.stream, { timeoutMs: 5, graceMs: 0 });
    expect(output.waiting()).toBe(0);
  });

  it('gives the process that reads the run a moment once the lines are in the pipe', async () => {
    // Nothing on this side observes when the process reading us got them, so the end of a run
    // waits a short, bounded moment for it.
    const started = Date.now();
    await flushRunOutput(fakeStream(0).stream, { graceMs: 20 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    await pause(0);
  });
});
