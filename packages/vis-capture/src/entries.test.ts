import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS_FORMAT_VERSION,
  isConsoleEntry,
  isNetworkEntry,
  isUserEventEntry,
  isWebSocketMessageEntry,
  type ConsoleEntry,
  type NetworkEntry,
  type UserEventEntry,
  type WebSocketMessageEntry,
} from './entries.js';

const consoleEntry: ConsoleEntry = {
  t: 120,
  ts: 1_763_000_000_120,
  level: 'error',
  args: ['Checkout failed', '{"code":42}'],
  stack: 'at pay (https://shop.test/app.js:10:3)',
  source: 'https://shop.test/app.js:10:3',
};

const networkEntry: NetworkEntry = {
  t: 300,
  ts: 1_763_000_000_300,
  id: 'req-1',
  kind: 'fetch',
  method: 'POST',
  url: 'https://shop.test/graphql',
  status: 200,
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  requestBody: {
    text: '{"query":"query Cart { cart { id } }"}',
    truncated: false,
    size: 38,
    omitted: null,
  },
  responseBody: { text: null, truncated: false, size: 2_000_000, omitted: 'too_large' },
  durationMs: 85,
  timing: { startMs: 300, ttfbMs: 60, responseMs: 25 },
  error: null,
  graphql: { operationName: 'Cart', operationType: 'query', hasErrors: true },
};

const webSocketEntry: WebSocketMessageEntry = {
  t: 400,
  ts: 1_763_000_000_400,
  socketId: 'ws-1',
  direction: 'received',
  data: '{"type":"price","value":10}',
};

const userEvent: UserEventEntry = {
  t: 500,
  ts: 1_763_000_000_500,
  type: 'click',
  target: { selector: 'button#pay', text: 'Pay', tag: 'button' },
  url: 'https://shop.test/checkout',
  x: 10,
  y: 20,
};

describe('the diagnostics format', () => {
  it('is version 1', () => {
    expect(DIAGNOSTICS_FORMAT_VERSION).toBe(1);
  });

  it('recognises each kind of entry by its own guard only', () => {
    const entries = [consoleEntry, networkEntry, webSocketEntry, userEvent];
    expect(entries.map(isConsoleEntry)).toEqual([true, false, false, false]);
    expect(entries.map(isNetworkEntry)).toEqual([false, true, false, false]);
    expect(entries.map(isWebSocketMessageEntry)).toEqual([false, false, true, false]);
    expect(entries.map(isUserEventEntry)).toEqual([false, false, false, true]);
  });

  it('accepts the smallest valid entry of each kind', () => {
    expect(isConsoleEntry({ t: 0, ts: 1, level: 'log', args: [] })).toBe(true);
    expect(
      isNetworkEntry({
        t: 0,
        ts: 1,
        id: 'a',
        kind: 'beacon',
        method: 'POST',
        url: 'https://a.test/',
        status: null,
        requestHeaders: {},
        responseHeaders: {},
        requestBody: null,
        responseBody: null,
        durationMs: null,
        timing: null,
        error: null,
        graphql: null,
      }),
    ).toBe(true);
    expect(isUserEventEntry({ t: 0, ts: 1, type: 'visibility', url: 'https://a.test/' })).toBe(
      true,
    );
  });

  it('rejects entries with a wrong or missing field', () => {
    expect(isConsoleEntry({ ...consoleEntry, level: 'fatal' })).toBe(false);
    expect(isConsoleEntry({ ...consoleEntry, args: ['ok', 1] })).toBe(false);
    expect(isConsoleEntry({ ...consoleEntry, t: '120' })).toBe(false);
    expect(isConsoleEntry({ level: 'log', args: [] })).toBe(false);
    expect(isNetworkEntry({ ...networkEntry, kind: 'grpc' })).toBe(false);
    expect(isNetworkEntry({ ...networkEntry, requestHeaders: { a: 1 } })).toBe(false);
    expect(isNetworkEntry({ ...networkEntry, responseBody: { text: 'x' } })).toBe(false);
    expect(isNetworkEntry({ ...networkEntry, status: '200' })).toBe(false);
    expect(isWebSocketMessageEntry({ ...webSocketEntry, direction: 'sideways' })).toBe(false);
    expect(isUserEventEntry({ ...userEvent, type: 'hover' })).toBe(false);
    expect(isUserEventEntry({ ...userEvent, x: 'left' })).toBe(false);
    expect(isConsoleEntry(null)).toBe(false);
    expect(isNetworkEntry('entry')).toBe(false);
  });
});

/** A copy of `value` without `key`. */
function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

describe('the shape the Probara API validates', () => {
  // The API parses each line with Zod schemas whose optional network fields are required and
  // nullable: a line that leaves one out is dropped by the viewer.
  it('requires every network field, with null where there is no value', () => {
    for (const key of [
      'status',
      'requestBody',
      'responseBody',
      'durationMs',
      'timing',
      'error',
      'graphql',
    ] as const) {
      expect(isNetworkEntry(without(networkEntry, key)), key).toBe(false);
    }
  });

  it('requires every body field, with null where there is no value', () => {
    for (const key of ['text', 'size', 'omitted'] as const) {
      const body = without(networkEntry.responseBody ?? {}, key);
      expect(isNetworkEntry({ ...networkEntry, responseBody: body }), key).toBe(false);
    }
    expect(
      isNetworkEntry({
        ...networkEntry,
        responseBody: { text: null, truncated: false, size: null, omitted: 'stream' },
      }),
    ).toBe(true);
  });

  it('requires the GraphQL operation name and type, null when unknown', () => {
    expect(
      isNetworkEntry({ ...networkEntry, graphql: { operationType: 'query', hasErrors: false } }),
    ).toBe(false);
    expect(
      isNetworkEntry({
        ...networkEntry,
        graphql: { operationName: null, operationType: null, hasErrors: false },
      }),
    ).toBe(true);
  });

  it('accepts a user event whose target is null', () => {
    expect(isUserEventEntry({ ...userEvent, target: null })).toBe(true);
  });
});
