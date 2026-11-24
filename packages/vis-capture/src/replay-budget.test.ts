/**
 * When a replay's work on DOM changes keeps the page busy long enough for a pause to pay, and when
 * the page has calmed down enough to resume, from timed traces instead of a loaded machine.
 */
import { describe, expect, it } from 'vitest';
import { createBusyMeter, REPLAY_BUDGET, type BusyMeter } from './replay-budget.js';

/** Feeds `[at, ms, weight]` batches; the times at which the meter called the page busy. */
function feed(meter: BusyMeter, trace: readonly (readonly [number, number, number?])[]): number[] {
  const busyAt: number[] = [];
  for (const [at, ms, weight = 1] of trace) {
    meter.changed(at, weight);
    if (meter.spent(at, ms) !== null) busyAt.push(at);
  }
  return busyAt;
}

/** The order list re-rendering every 400 ms from `from` until `to`, about 60 ms each time. */
function churn(from: number, to: number): [number, number, number][] {
  const trace: [number, number, number][] = [];
  for (let at = from; at < to; at += 400) trace.push([at, 60, 400]);
  return trace;
}

describe('createBusyMeter', () => {
  it('asks for three windows of 2 s, 100 ms each, by default', () => {
    expect(REPLAY_BUDGET).toEqual({
      windowMs: 2_000,
      mainThreadMs: 100,
      busyWindows: 3,
      pauseMs: 10_000,
    });
  });

  it('never calls busy the navigations of VIS-20', () => {
    const meter = createBusyMeter(REPLAY_BUDGET, 0);
    // The order list opens at 1.4 s (an 87 ms batch, 120 ms in its window), the asset list at 6.3 s:
    // VIS-20 was paused then, so its 190 ms and 25 ms are assumed, about its resume snapshot.
    const trace = [
      [1_400, 87],
      [1_600, 13],
      [2_200, 20],
      [6_300, 190],
      [6_600, 25],
      [9_000, 4],
    ] as const;
    expect(feed(meter, trace)).toEqual([]);
  });

  it('never calls busy a burst across two windows', () => {
    const meter = createBusyMeter(REPLAY_BUDGET, 0);
    expect(
      feed(meter, [
        [1_900, 150],
        [2_100, 150],
        [4_100, 1],
      ]),
    ).toEqual([]);
  });

  it('calls busy a page that re-renders a large table every 400 ms, in its third window', () => {
    const meter = createBusyMeter(REPLAY_BUDGET, 0);
    const trace = churn(0, 6_000);
    expect(feed(meter, trace)[0]).toBe(4_400);
    const again = createBusyMeter(REPLAY_BUDGET, 0);
    const pause = trace.map(([at, ms, weight]) => {
      again.changed(at, weight);
      return again.spent(at, ms);
    });
    expect(pause.find((spent) => spent !== null)).toEqual({ mainThreadMs: 720 });
  });

  it('starts counting over after a window under the budget', () => {
    const meter = createBusyMeter(REPLAY_BUDGET, 0);
    const busy = [...churn(0, 4_000), [4_500, 10], ...churn(6_000, 10_000)] as const;
    expect(feed(meter, busy)).toEqual([]);
    expect(feed(meter, churn(10_000, 11_000))[0]).toBe(10_400);
  });

  it('starts counting over after a window without changes', () => {
    const meter = createBusyMeter(REPLAY_BUDGET, 0);
    expect(feed(meter, [...churn(0, 4_000), ...churn(6_000, 8_800)])).toEqual([]);
  });

  it('starts over from reset', () => {
    const meter = createBusyMeter(REPLAY_BUDGET, 0);
    expect(feed(meter, churn(0, 4_000))).toEqual([]);
    meter.reset(4_000);
    expect(feed(meter, churn(4_000, 8_000))).toEqual([]);
    expect(feed(meter, churn(8_000, 9_000))[0]).toBe(8_400);
  });

  describe('once busy', () => {
    function busy(): BusyMeter {
      const meter = createBusyMeter(REPLAY_BUDGET, 0);
      feed(meter, churn(0, 4_800));
      return meter;
    }

    it('calls calm a window without changes', () => {
      expect(busy().calm()).toBe(true);
    });

    it('calls calm a window of small changes, such as a ticking clock', () => {
      const meter = busy();
      meter.changed(5_000, 2);
      meter.changed(6_000, 2);
      expect(meter.calm()).toBe(true);
    });

    it('never calls calm a window that changes as much as when it was busy', () => {
      const meter = busy();
      for (let at = 4_800; at < 6_800; at += 400) meter.changed(at, 400);
      expect(meter.calm()).toBe(false);
    });

    it('counts each window on its own', () => {
      const meter = busy();
      for (let at = 4_800; at < 6_800; at += 400) meter.changed(at, 400);
      expect(meter.calm()).toBe(false);
      meter.changed(7_000, 2);
      expect(meter.calm()).toBe(true);
    });
  });
});
