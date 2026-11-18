import { describe, expect, it } from 'vitest';
import { createRecordingSession, type ConsoleEntry } from './index.js';

function fakeClock(start = 1000, epoch = 1_763_000_000_000) {
  const clock = { mono: start, epoch };
  return {
    clock,
    advance: (ms: number): void => {
      clock.mono += ms;
      clock.epoch += ms;
    },
    source: { now: () => clock.mono, epoch: () => clock.epoch },
  };
}

function log(n: number, text = 'x'): ConsoleEntry {
  return { t: n, ts: n, level: 'log', args: [text] };
}

describe('a recording session', () => {
  it('stamps entries with ms since start and the epoch time', () => {
    const { source, advance } = fakeClock();
    const session = createRecordingSession({ clock: source });
    expect(session.state).toBe('idle');
    session.start();
    expect(session.state).toBe('recording');
    advance(250);
    expect(session.stamp()).toEqual({ t: 250, ts: 1_763_000_000_250 });
    advance(1000);
    expect(session.stamp()).toEqual({ t: 1250, ts: 1_763_000_001_250 });
  });

  it('records only while recording, and keeps what it recorded after stop', () => {
    const session = createRecordingSession({ clock: fakeClock().source });
    expect(session.record('console', log(1))).toBe(false);
    session.start();
    expect(session.record('console', log(2))).toBe(true);
    session.stop();
    expect(session.state).toBe('stopped');
    expect(session.record('console', log(3))).toBe(false);
    expect(session.entries('console')).toEqual([log(2)]);
  });

  it('keeps its start time when started twice', () => {
    const { source, advance } = fakeClock();
    const session = createRecordingSession({ clock: source });
    session.start();
    advance(100);
    session.start();
    advance(50);
    expect(session.stamp().t).toBe(150);
  });

  it('keeps each stream in its own buffer', () => {
    const session = createRecordingSession({ clock: fakeClock().source });
    session.start();
    session.record('console', log(1));
    session.record('events', { t: 2, ts: 2, type: 'click', url: 'https://a.test/' });
    expect(session.entries('console')).toHaveLength(1);
    expect(session.entries('events')).toHaveLength(1);
    expect(session.entries('network')).toEqual([]);
  });

  it('keeps each stream in time order, whatever order its entries are recorded in', () => {
    const session = createRecordingSession({
      clock: fakeClock().source,
      limits: { console: { maxEntries: 3 } },
    });
    session.start();
    for (const n of [5, 3, 7, 3, 1]) session.record('console', log(n, String(n)));
    // Equal times keep the order they were recorded in; the oldest are dropped first.
    expect(session.entries('console').map((entry) => entry.t)).toEqual([3, 5, 7]);
    expect(session.dropped('console')).toBe(2);
  });

  it('drops the oldest entries past the entry limit and counts them', () => {
    const session = createRecordingSession({
      clock: fakeClock().source,
      limits: { console: { maxEntries: 3 } },
    });
    session.start();
    for (let n = 1; n <= 5; n++) session.record('console', log(n));
    expect(session.entries('console').map((entry) => entry.t)).toEqual([3, 4, 5]);
    expect(session.dropped('console')).toBe(2);
    expect(session.dropped('network')).toBe(0);
  });

  it('drops the oldest entries past the byte limit of their NDJSON lines', () => {
    // Every entry here is one NDJSON line of the same size: its JSON and the newline.
    const line = JSON.stringify(log(1, 'abc')).length + 1;
    const session = createRecordingSession({
      clock: fakeClock().source,
      limits: { console: { maxBytes: line * 2 } },
    });
    session.start();
    for (let n = 1; n <= 4; n++) session.record('console', log(n, 'abc'));
    expect(session.entries('console').map((entry) => entry.t)).toEqual([3, 4]);
    expect(session.dropped('console')).toBe(2);
  });

  it('drops an entry larger than the whole byte limit, keeping the others', () => {
    const session = createRecordingSession({
      clock: fakeClock().source,
      limits: { console: { maxBytes: 100 } },
    });
    session.start();
    session.record('console', log(1));
    expect(session.record('console', log(2, 'y'.repeat(200)))).toBe(false);
    expect(session.entries('console').map((entry) => entry.t)).toEqual([1]);
    expect(session.dropped('console')).toBe(1);
  });

  it('drops the entries older than maxAgeMs, when recording and when read, and counts them', () => {
    const { source, advance } = fakeClock();
    const session = createRecordingSession({
      clock: source,
      limits: { console: { maxAgeMs: 1000 }, events: { maxAgeMs: 1000 } },
    });
    session.start();
    advance(100);
    session.record('console', log(100, 'a'));
    advance(500);
    session.record('console', log(600, 'b'));
    session.record('events', { t: 600, ts: 600, type: 'click', url: 'https://a.test/' });
    advance(700);
    // At 1300 the entry of 100 is older than 1000 ms: recording another drops it.
    session.record('console', log(1300, 'c'));
    expect(session.entries('console').map((entry) => entry.args[0])).toEqual(['b', 'c']);
    expect(session.dropped('console')).toBe(1);
    // Reading drops what aged out meanwhile, without a new entry.
    advance(400);
    expect(session.entries('console').map((entry) => entry.args[0])).toEqual(['c']);
    expect(session.entries('events')).toEqual([]);
    expect(session.dropped('console')).toBe(2);
    expect(session.dropped('events')).toBe(1);
  });

  it('keeps the window of a stopped session as it was when it stopped', () => {
    const { source, advance } = fakeClock();
    const session = createRecordingSession({
      clock: source,
      limits: { console: { maxAgeMs: 1000 } },
    });
    session.start();
    advance(500);
    session.record('console', log(500));
    session.stop();
    advance(5000);
    expect(session.entries('console').map((entry) => entry.t)).toEqual([500]);
  });

  it('keeps entries of any age without maxAgeMs', () => {
    const { source, advance } = fakeClock();
    const session = createRecordingSession({ clock: source });
    session.start();
    session.record('console', log(0));
    advance(3_600_000);
    session.record('console', log(3_600_000));
    expect(session.entries('console')).toHaveLength(2);
    expect(session.dropped('console')).toBe(0);
  });

  it('starts a new recording with empty buffers after a stop', () => {
    const { source, advance } = fakeClock();
    const session = createRecordingSession({
      clock: source,
      limits: { console: { maxEntries: 1 } },
    });
    session.start();
    session.record('console', log(1));
    session.record('console', log(2));
    session.stop();
    advance(500);
    session.start();
    expect(session.entries('console')).toEqual([]);
    expect(session.dropped('console')).toBe(0);
    expect(session.stamp().t).toBe(0);
  });
});
