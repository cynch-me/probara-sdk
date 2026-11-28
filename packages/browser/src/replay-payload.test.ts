import type { CaptureSnapshot } from '@probara/vis-capture';
import { describe, expect, it } from 'vitest';
import { replayLines } from './replay-payload.js';

const consoleEntry = { t: 10, ts: 1_010, level: 'error' as const, args: ['cart is undefined'] };
const request = {
  t: 20,
  ts: 1_020,
  id: 'r1',
  kind: 'fetch' as const,
  method: 'POST',
  url: 'https://api.shop.test/orders',
  status: 500,
  requestHeaders: { authorization: '[REDACTED]' },
  responseHeaders: {},
  requestBody: null,
  responseBody: null,
  durationMs: 12,
  timing: null,
  error: null,
  graphql: null,
};
const click = {
  t: 5,
  ts: 1_005,
  type: 'click' as const,
  url: 'https://shop.test/cart',
  x: 1,
  y: 2,
};

function snapshotOf(parts: Partial<CaptureSnapshot>): CaptureSnapshot {
  return { events: [], console: [], network: [], userEvents: [], at: 2_000, ...parts };
}

describe('replayLines', () => {
  it('turns console, network and user event entries into tagged rrweb custom events', () => {
    const lines = replayLines(
      snapshotOf({
        events: [{ type: 4, timestamp: 1_000 }],
        console: [consoleEntry],
        network: [request],
        userEvents: [click],
      }),
    );
    expect(lines).toEqual([
      { type: 4, timestamp: 1_000 },
      { type: 5, timestamp: 1_005, data: { tag: 'probara.events', payload: click } },
      { type: 5, timestamp: 1_010, data: { tag: 'probara.console', payload: consoleEntry } },
      { type: 5, timestamp: 1_020, data: { tag: 'probara.network', payload: request } },
    ]);
  });

  it('drops the entries older than the first replay event', () => {
    const early = { ...consoleEntry, ts: 999, args: ['before the replay'] };
    const lines = replayLines(
      snapshotOf({ events: [{ type: 4, timestamp: 1_000 }], console: [early, consoleEntry] }),
    );
    expect(lines).toEqual([
      { type: 4, timestamp: 1_000 },
      { type: 5, timestamp: 1_010, data: { tag: 'probara.console', payload: consoleEntry } },
    ]);
  });

  it('orders every line by timestamp, replay events first on a tie', () => {
    const tied = { ...consoleEntry, ts: 1_500 };
    const lines = replayLines(
      snapshotOf({
        events: [
          { type: 4, timestamp: 1_000 },
          { type: 3, timestamp: 1_500 },
          { type: 3, timestamp: 1_800 },
        ],
        console: [tied],
        userEvents: [click],
      }),
    );
    expect(lines.map((line) => [line.type, line.timestamp])).toEqual([
      [4, 1_000],
      [5, 1_005],
      [3, 1_500],
      [5, 1_500],
      [3, 1_800],
    ]);
  });
});
