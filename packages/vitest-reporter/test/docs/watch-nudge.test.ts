/**
 * The rule of the repeated save in a watch session (V-D118): a save that no re-run followed is repeated once the interval
 * has passed; a save a re-run started for is never repeated, however slow that re-run is, since a second re-run would
 * then follow a seen save. Each run has its own state (V-D122): its labels are those printed after its own save.
 */
import { describe, expect, it } from 'vitest';
import { nudgeDue, RunNudge } from './watch-nudge.js';

describe('nudgeDue', () => {
  it('repeats a save that no re-run followed within the interval', () => {
    expect(nudgeDue({ sinceSaveMs: 10_001, intervalMs: 10_000, startedSinceSave: false })).toBe(
      true,
    );
  });

  it('waits out the interval before it repeats a save', () => {
    expect(nudgeDue({ sinceSaveMs: 10_000, intervalMs: 10_000, startedSinceSave: false })).toBe(
      false,
    );
  });

  it('never repeats a save a re-run started for, however slow that re-run is', () => {
    expect(nudgeDue({ sinceSaveMs: 60_000, intervalMs: 10_000, startedSinceSave: true })).toBe(
      false,
    );
  });
});

describe('RunNudge', () => {
  it('judges each run by the labels printed after its own save, never by an earlier run', () => {
    // Run 2: a label answers its save within the interval, so nothing is repeated.
    const second = new RunNudge({ at: 0, labels: 0 });
    expect(second.due({ now: 5_000, labels: 1, intervalMs: 10_000 })).toBe(false);
    // Run 3: its save comes after that label, so the label is its baseline, and a save no re-run followed is repeated.
    const third = new RunNudge({ at: 20_000, labels: 1 });
    expect(third.due({ now: 31_000, labels: 1, intervalMs: 10_000 })).toBe(true);
  });

  it('keeps a repeated save with its run: a label printed after the repeat answers that run', () => {
    const run = new RunNudge({ at: 0, labels: 0 });
    expect(run.due({ now: 10_001, labels: 0, intervalMs: 10_000 })).toBe(true);
    run.repeat({ now: 10_001, labels: 0 });
    expect(run.due({ now: 30_000, labels: 1, intervalMs: 10_000 })).toBe(false);
  });
});
