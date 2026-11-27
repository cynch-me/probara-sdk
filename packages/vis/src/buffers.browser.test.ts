/**
 * The pre-click buffers with a stand-in replay recorder: what is offered while the replay pauses on
 * a busy page, and what a handed-over replay ends with.
 */
import {
  REPLAY_BUDGET,
  REPLAY_CHECKOUT_MS,
  REPLAY_HEALTH_TAG,
  REPLAY_MAX_SIZE,
  REPLAY_PAUSED_TAG,
  replayHealthEvent,
  type ReplayEvent,
  type ReplayHealth,
  type ReplayRecorder,
} from '@probara/vis-capture/replay';
import { attachSharedCapture, type SharedCapture } from '@probara/vis-capture';
import { afterEach, describe, expect, it } from 'vitest';
import { startPreClickBuffers, type PreClickBuffers } from './buffers.js';
import type { ReplayModule } from './replay-loader.js';

const started: PreClickBuffers[] = [];
const others: SharedCapture[] = [];

afterEach(() => {
  for (const buffers of started.splice(0)) buffers.stop();
  for (const other of others.splice(0)) other.release();
});

const HEALTH: ReplayHealth = {
  pauses: 1,
  checkouts: 1,
  size: 300,
  recordedSize: 300,
  largestBatch: null,
  longestSnapshotMs: 4,
  mainThreadMs: 5,
};

/** A replay that paused at `pausedAt` on a busy page. */
function pausedReplay(pausedAt: number): ReplayModule {
  const events = [
    { type: 4, data: { href: 'https://a.test/', width: 1, height: 1 }, timestamp: pausedAt - 1000 },
    {
      type: 2,
      data: { node: {}, initialOffset: { top: 0, left: 0 } },
      timestamp: pausedAt - 1000,
    },
    { type: 5, data: { tag: REPLAY_PAUSED_TAG, payload: {} }, timestamp: pausedAt },
  ] as unknown as ReplayEvent[];
  const recorder: ReplayRecorder = {
    mode: 'rolling',
    active: true,
    paused: true,
    health: HEALTH,
    coverage: { from: pausedAt - 1000, to: pausedAt },
    start: () => undefined,
    stop: () => undefined,
    checkout: () => undefined,
    events: () => [...events],
  };
  return {
    REPLAY_BUDGET,
    REPLAY_CHECKOUT_MS,
    REPLAY_HEALTH_TAG,
    REPLAY_MAX_SIZE,
    REPLAY_PAUSED_TAG,
    replayHealthEvent,
    createReplayRecorder: () => recorder,
  };
}

function start(replay: ReplayModule): PreClickBuffers {
  const buffers = startPreClickBuffers({ replay, blur: [], ignoreUrls: [], ignore: () => false });
  started.push(buffers);
  return buffers;
}

describe('the pre-click buffers', () => {
  it('offer the replay while it is paused on a busy page', () => {
    const buffers = start(pausedReplay(Date.now() - 60_000));
    expect(buffers.available).toBe(true);
    expect(buffers.freeze()?.events).toHaveLength(4);
  });

  it('end what they hand over with the health of the replay, stamped at the copy', () => {
    const buffers = start(pausedReplay(Date.now() - 60_000));
    const frozen = buffers.freeze();
    expect(frozen?.events.at(-1)).toEqual({
      type: 5,
      data: { tag: 'probara/replay-health', payload: HEALTH },
      timestamp: frozen?.at,
    });
  });
});

describe('the pre-click buffers beside another Probara SDK', () => {
  /** The replay of `pausedReplay`, counting the recorders created. */
  function counted(module: ReplayModule): { module: ReplayModule; created: () => number } {
    let created = 0;
    return {
      module: {
        ...module,
        createReplayRecorder: (options) => {
          created += 1;
          return module.createReplayRecorder(options);
        },
      },
      created: () => created,
    };
  }

  it('attach to the capture the other SDK started: one replay recorder, one console patch', () => {
    const replay = counted(pausedReplay(Date.now() - 60_000));
    const other = attachSharedCapture({ replay: replay.module });
    others.push(other);
    const patched = console.warn;
    const buffers = start(replay.module);
    expect(console.warn).toBe(patched);
    expect(replay.created()).toBe(1);
    expect(buffers.available).toBe(true);
    expect(buffers.snapshot()?.events[0]?.type).toBe(4);
  });

  it('leave the capture running for the other SDK when they freeze', () => {
    const replay = counted(pausedReplay(Date.now() - 60_000));
    const other = attachSharedCapture({ replay: replay.module });
    others.push(other);
    const buffers = start(replay.module);
    buffers.freeze();
    expect(other.available).toBe(true);
    expect(other.snapshot()).not.toBeNull();
  });
});
