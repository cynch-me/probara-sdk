/**
 * The page-wide shared capture in a real Chromium page: every Probara SDK on the page attaches to
 * one set of console, network and user event interceptors and one DOM replay recorder, reads it
 * without emptying it, and the page is put back once the last one releases it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as replayEntry from './replay.js';
import {
  ERROR_CAPTURE_WINDOW_MS,
  SHARED_CAPTURE_KEY,
  SHARED_CAPTURE_WINDOW_MS,
  attachSharedCapture,
  type CaptureRecord,
  type CaptureReplayEvent,
  type CaptureReplayModule,
  type SharedCapture,
} from './shared-capture.js';

const handles: SharedCapture[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.release();
  Reflect.deleteProperty(globalThis, SHARED_CAPTURE_KEY);
});

function attach(options: Parameters<typeof attachSharedCapture>[0] = {}): SharedCapture {
  const handle = attachSharedCapture(options);
  handles.push(handle);
  return handle;
}

/** The real replay entry, counting the recorders it creates. */
function countedReplay(): { module: CaptureReplayModule; created: () => number } {
  let created = 0;
  return {
    module: {
      REPLAY_BUDGET: replayEntry.REPLAY_BUDGET,
      replayHealthEvent: replayEntry.replayHealthEvent,
      createReplayRecorder(options) {
        created += 1;
        return replayEntry.createReplayRecorder(options);
      },
    },
    created: () => created,
  };
}

/** A replay that holds full snapshots taken at the given epoch milliseconds. */
function replayCheckedOutAt(times: readonly number[]): CaptureReplayModule {
  const events: CaptureReplayEvent[] = times.flatMap((timestamp) => [
    { type: 4, timestamp },
    { type: 2, timestamp },
    { type: 3, timestamp: timestamp + 1 },
  ]);
  return {
    REPLAY_BUDGET: replayEntry.REPLAY_BUDGET,
    replayHealthEvent: (_health, timestamp) => ({ type: 5, timestamp }),
    createReplayRecorder: () => ({
      health: {},
      coverage: { from: times[0] ?? 0, to: (times.at(-1) ?? 0) + 1 },
      start: () => undefined,
      stop: () => undefined,
      checkout: () => undefined,
      events: () => [...events],
    }),
  };
}

const consoleArgs = (records: readonly CaptureRecord[]): string[][] =>
  records.flatMap((record) => (record.stream === 'console' ? [record.entry.args] : []));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the shared capture', () => {
  it('patches the console once for every SDK on the page and hands each one what it records', () => {
    const first = attach();
    const patched = console.info;
    const second = attach();
    expect(console.info).toBe(patched);
    const seenByFirst: CaptureRecord[] = [];
    const seenBySecond: CaptureRecord[] = [];
    first.subscribe((record) => {
      seenByFirst.push(record);
    });
    second.subscribe((record) => {
      seenBySecond.push(record);
    });

    console.info('shared line');

    expect(consoleArgs(seenByFirst)).toEqual([['shared line']]);
    expect(consoleArgs(seenBySecond)).toEqual([['shared line']]);
  });

  it('is registered page-wide under Symbol.for("probara.capture"), where a second copy attaches', () => {
    const first = attach();
    const registry = (globalThis as Record<symbol, unknown>)[Symbol.for('probara.capture')] as {
      protocol: number;
      attach: typeof attachSharedCapture;
    };
    expect(registry.protocol).toBe(1);
    const second = registry.attach({});
    handles.push(second);
    expect(first.owner).toBe(true);
    expect(second.owner).toBe(false);
    expect(second.snapshot()).toBeNull();
    expect(
      consoleArgs(
        collect(second, () => {
          console.info('later');
        }),
      ),
    ).toEqual([['later']]);
  });

  it('keeps capturing for the others when one releases, and puts the page back when the last does', () => {
    const original = console.info;
    const first = attach();
    const second = attach();
    first.release();
    expect(
      consoleArgs(
        collect(second, () => {
          console.info('still captured');
        }),
      ),
    ).toEqual([['still captured']]);
    second.release();
    expect(console.info).toBe(original);
    expect((globalThis as Record<symbol, unknown>)[SHARED_CAPTURE_KEY]).toBeUndefined();
  });

  it('starts one replay recorder for every SDK that asks for one', () => {
    const replay = countedReplay();
    const first = attach({ replay: replay.module });
    const second = attach({ replay: replay.module });
    expect(replay.created()).toBe(1);
    expect(first.available).toBe(true);
    expect(second.snapshot()?.events[0]?.type).toBe(4);
  });

  it('starts the replay for an SDK that asks for it after the capture started without one', () => {
    const replay = countedReplay();
    const first = attach();
    expect(first.available).toBe(false);
    const second = attach();
    second.startReplay(replay.module);
    second.startReplay(replay.module);
    expect(replay.created()).toBe(1);
    expect(first.available).toBe(true);
  });

  it('reads what it holds without emptying it, and goes on capturing', () => {
    const handle = attach({ replay: countedReplay().module });
    console.info('one');
    const before = handle.snapshot();
    const again = handle.snapshot();
    console.info('two');
    const after = handle.snapshot();
    expect(before?.console.map((entry) => entry.args)).toEqual([['one']]);
    expect(again?.console.map((entry) => entry.args)).toEqual([['one']]);
    expect(after?.console.map((entry) => entry.args)).toEqual([['one'], ['two']]);
  });

  it('restarts the view of one SDK from a new full snapshot, leaving the others whole', () => {
    const replay = countedReplay();
    const first = attach({ replay: replay.module });
    const second = attach({ replay: replay.module });
    console.info('before');
    const restartedAt = Date.now();
    second.restart();
    console.info('after');
    const restarted = second.snapshot();
    expect(restarted?.console.map((entry) => entry.args)).toEqual([['after']]);
    expect(restarted?.events[0]?.type).toBe(4);
    expect(restarted?.events[0]?.timestamp).toBeGreaterThanOrEqual(restartedAt);
    expect(first.snapshot()?.console.map((entry) => entry.args)).toEqual([['before'], ['after']]);
  });

  it('applies the sanitizers of every SDK on the page to what each one reads', () => {
    attach({ logSanitizer: (entry) => (entry.args.join(' ').includes('secret') ? null : entry) });
    const other = attach();
    expect(
      consoleArgs(
        collect(other, () => {
          console.info('a secret line');
          console.info('a plain line');
        }),
      ),
    ).toEqual([['a plain line']]);
  });

  it('leaves out the requests any SDK on the page ignores', async () => {
    attach({ ignoreUrls: [`${location.origin}/probara-ignored`] });
    const other = attach();
    const urls: string[] = [];
    other.subscribe((record) => {
      if (record.stream === 'network' && 'url' in record.entry) urls.push(record.entry.url);
    });
    await fetch('/probara-ignored').catch(() => undefined);
    await fetch('/probara-kept').catch(() => undefined);
    await sleep(200);
    expect(urls.some((url) => url.endsWith('/probara-kept'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/probara-ignored'))).toBe(false);
  });

  it('never hands over what the replay recorded before an SDK attached with more to blur, even within the same millisecond', () => {
    const secret = document.createElement('p');
    secret.className = 'blurred-later';
    secret.textContent = 'text-blurred-later';
    document.body.append(secret);
    try {
      const first = attach({ replay: countedReplay().module });
      const recorded = first.snapshot()?.events;
      expect(JSON.stringify(recorded)).toContain('text-blurred-later');
      const now = vi.spyOn(Date, 'now').mockReturnValue(recorded?.[0]?.timestamp ?? 0);
      try {
        attach({ blur: ['.blurred-later'] });
      } finally {
        now.mockRestore();
      }
      expect(JSON.stringify(first.snapshot()?.events)).not.toContain('text-blurred-later');
    } finally {
      secret.remove();
    }
  });

  it('keeps when a WebSocket opened and closed but none of its messages while only error monitoring is attached', async () => {
    const original = globalThis.WebSocket;
    class StandInSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      protocol = '';
      constructor(readonly url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(): void {}
      close(code = 1000, reason = ''): void {
        this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
      }
    }
    globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
    try {
      const handle = attach({ retention: 'errors' });
      const records: CaptureRecord[] = [];
      handle.subscribe((record) => {
        records.push(record);
      });
      const socket = new WebSocket('wss://socket.example/feed');
      await sleep(0);
      socket.send('sent-private-payload');
      socket.dispatchEvent(new MessageEvent('message', { data: 'received-private-payload' }));
      socket.close(4001, 'gone');
      const network = records.flatMap((record) =>
        record.stream === 'network' ? [record.entry] : [],
      );
      expect(JSON.stringify(network)).not.toContain('private-payload');
      expect(network).toEqual([
        expect.objectContaining({
          kind: 'websocket',
          url: 'wss://socket.example/feed',
          status: 101,
          error: 'Closed with code 4001: gone',
        }),
      ]);
    } finally {
      globalThis.WebSocket = original;
    }
  });

  it('hands over the replay from the newest full snapshot that still covers the lookback asked for', () => {
    const now = Date.now();
    const handle = attach({
      replay: replayCheckedOutAt([now - 100_000, now - 50_000, now - 10_000]),
    });
    expect(handle.snapshot({ lookbackMs: 60_000 })?.events[0]?.timestamp).toBe(now - 100_000);
    expect(handle.snapshot({ lookbackMs: 20_000 })?.events[0]?.timestamp).toBe(now - 50_000);
    expect(handle.snapshot()?.events[0]?.timestamp).toBe(now - 100_000);
  });

  it('keeps an error-sized replay lookback until an SDK that needs the full window attaches', () => {
    const lookbacks: (number | undefined)[] = [];
    const base = replayCheckedOutAt([Date.now()]);
    const module: CaptureReplayModule = {
      ...base,
      createReplayRecorder(options) {
        lookbacks.push(options.lookbackMs);
        return {
          ...base.createReplayRecorder(options),
          setLookback(ms: number) {
            lookbacks.push(ms);
          },
        };
      },
    };
    attach({ retention: 'errors', replay: module });
    const vis = attach();
    vis.release();
    expect(lookbacks).toEqual([
      ERROR_CAPTURE_WINDOW_MS,
      SHARED_CAPTURE_WINDOW_MS,
      ERROR_CAPTURE_WINDOW_MS,
    ]);
  });

  it('captures on its own, leaving the page-wide slot alone, beside a capture of another protocol', () => {
    const foreign = { protocol: 99 };
    (globalThis as Record<symbol, unknown>)[SHARED_CAPTURE_KEY] = foreign;
    const handle = attach();
    expect(handle.owner).toBe(true);
    expect((globalThis as Record<symbol, unknown>)[SHARED_CAPTURE_KEY]).toBe(foreign);
    expect(
      consoleArgs(
        collect(handle, () => {
          console.info('private');
        }),
      ),
    ).toEqual([['private']]);
  });
});

/** What `handle` is handed while `act` runs. */
function collect(handle: SharedCapture, act: () => void): CaptureRecord[] {
  const seen: CaptureRecord[] = [];
  const unsubscribe = handle.subscribe((record) => {
    seen.push(record);
  });
  act();
  unsubscribe();
  return seen;
}
