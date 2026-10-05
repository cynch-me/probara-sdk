/**
 * Waiting for what a test observes, the way a test of an asynchronous boundary should: a reporter
 * hands its results to an HTTP call nobody waits for (the reporter process is killed ~50 ms after
 * the last spec), and how long that takes depends on the machine, not on the code. A fixed sleep is
 * a race that a loaded CI runner loses and a laptop wins, so the wait is for the thing itself.
 */
import { describe, expect, it } from 'vitest';
import { until } from './wait.js';

describe('waiting for what a test observes', () => {
  it('returns as soon as the condition holds', async () => {
    let seen = 0;
    await until(() => {
      seen += 1;
      return seen >= 3;
    }, 'three checks');

    expect(seen).toBe(3);
  });

  it('checks an already true condition once, and does not wait', async () => {
    let checks = 0;
    const started = Date.now();
    await until(() => {
      checks += 1;
      return true;
    }, 'nothing to wait for');

    expect(checks).toBe(1);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('takes an asynchronous condition, which is what a report of a run is', async () => {
    let sent = 0;
    await until(() => {
      sent += 1;
      return Promise.resolve(sent >= 2);
    }, 'two sends');

    expect(sent).toBe(2);
  });

  it('gives up, naming what it was waiting for', async () => {
    const problem = until(() => false, 'a report that never arrives', 60);

    // The reason a test failed has to be the thing that never happened, not a timeout.
    await expect(problem).rejects.toThrow(/a report that never arrives/);
  });
});
