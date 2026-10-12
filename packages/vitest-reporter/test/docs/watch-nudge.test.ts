/**
 * The rule of the repeated save in a watch session (V-D118): a save that no re-run followed is repeated once the interval
 * has passed; a save a re-run started for is never repeated, however slow that re-run is, since a second re-run would
 * then follow a seen save.
 */
import { describe, expect, it } from 'vitest';
import { nudgeDue } from './watch-nudge.js';

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
