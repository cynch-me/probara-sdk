/**
 * The pre-click buffers with a stand-in replay recorder: what is offered once the replay stopped
 * itself on a busy page.
 */
import {
  REPLAY_HEALTH_TAG,
  replayHealthEvent,
  type ReplayEvent,
  type ReplayHealth,
  type ReplayRecorder,
} from '@probara/vis-capture/replay';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTANT_REPLAY_WINDOW_MS, startPreClickBuffers, type PreClickBuffers } from './buffers.js';
import type { ReplayModule } from './replay-loader.js';

const started: PreClickBuffers[] = [];

afterEach(() => {
  for (const buffers of started.splice(0)) buffers.stop();
});

const HEALTH: ReplayHealth = {
  stopReason: null,
  checkouts: 1,
  size: 300,
  recordedSize: 300,
  largestBatch: null,
  longestSnapshotMs: 4,
  mainThreadMs: 5,
};

/** A replay that stopped itself at `stoppedAt` past its mutation limit. */
function stoppedReplay(stoppedAt: number): ReplayModule {
  const events = [
    {
      type: 4,
      data: { href: 'https://a.test/', width: 1, height: 1 },
      timestamp: stoppedAt - 1000,
    },
    {
      type: 2,
      data: { node: {}, initialOffset: { top: 0, left: 0 } },
      timestamp: stoppedAt - 1000,
    },
    { type: 5, data: { tag: 'probara/replay-stopped', payload: {} }, timestamp: stoppedAt },
  ] as unknown as ReplayEvent[];
  const recorder: ReplayRecorder = {
    mode: 'rolling',
    active: false,
    stopReason: 'mutation_limit',
    health: { ...HEALTH, stopReason: 'mutation_limit' },
    coverage: { from: stoppedAt - 1000, to: stoppedAt },
    start: () => undefined,
    stop: () => undefined,
    events: () => [...events],
  };
  return {
    REPLAY_CHECKOUT_MS: 120_000,
    REPLAY_MUTATION_LIMIT: 10_000,
    REPLAY_STOPPED_TAG: 'probara/replay-stopped',
    REPLAY_HEALTH_TAG,
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
  it('still offer a replay that stopped itself within the time window', () => {
    const buffers = start(stoppedReplay(Date.now() - 60_000));
    expect(buffers.available).toBe(true);
    expect(buffers.freeze()?.events).toHaveLength(4);
  });

  it('end what they hand over with the health of the replay, stamped at its last event', () => {
    const stoppedAt = Date.now() - 60_000;
    const buffers = start(stoppedReplay(stoppedAt));
    expect(buffers.freeze()?.events.at(-1)).toEqual({
      type: 5,
      data: { tag: 'probara/replay-health', payload: { ...HEALTH, stopReason: 'mutation_limit' } },
      timestamp: stoppedAt,
    });
  });

  it('offer no replay that stopped itself longer ago than the time window', () => {
    const buffers = start(stoppedReplay(Date.now() - INSTANT_REPLAY_WINDOW_MS - 1000));
    expect(buffers.available).toBe(false);
    expect(buffers.freeze()).toBeNull();
  });
});
