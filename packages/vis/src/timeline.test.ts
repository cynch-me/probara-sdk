import { describe, expect, it } from 'vitest';
import type { Frozen } from './buffers.js';
import { onReplayTimeline } from './timeline.js';

const event = (timestamp: number) =>
  ({ type: 3, data: {}, timestamp }) as unknown as Frozen['events'][number];
const log = (t: number, ts: number, text: string) => ({
  t,
  ts,
  level: 'error' as const,
  args: [text],
});

describe('an instant replay on its own timeline', () => {
  it('lasts from its first event to the copy', () => {
    const frozen: Frozen = {
      events: [event(10_000), event(12_000)],
      console: [],
      network: [],
      userEvents: [],
      at: 15_000,
    };
    expect(onReplayTimeline(frozen).durationMs).toBe(5_000);
  });

  it('counts every entry from the first event and leaves out what came before it', () => {
    const frozen: Frozen = {
      events: [event(10_000), event(12_000)],
      console: [
        log(1_000, 9_000, 'before'),
        log(3_000, 11_000, 'during'),
        log(5_000, 14_000, 'after'),
      ],
      network: [],
      userEvents: [],
      at: 15_000,
    };
    expect(onReplayTimeline(frozen).frozen.console).toEqual([
      log(1_000, 11_000, 'during'),
      log(4_000, 14_000, 'after'),
    ]);
  });

  it('places a held replay and the live one on one timeline, whatever each session counted from', () => {
    const frozen: Frozen = {
      events: [event(10_000), event(11_000), event(40_000), event(41_000)],
      console: [log(500, 10_500, 'held'), log(200, 40_200, 'live')],
      network: [],
      userEvents: [],
      at: 42_000,
    };
    const { frozen: placed, durationMs } = onReplayTimeline(frozen);
    expect(placed.console.map((entry) => entry.t)).toEqual([500, 30_200]);
    expect(durationMs).toBe(32_000);
  });
});
