import type { RecordingClock } from '@probara/vis-capture';

/** A recording clock that stands still while paused, so `t` follows the video's own time. */
export interface PausableClock extends RecordingClock {
  pause(): void;
  resume(): void;
}

/** `monotonic` and `epoch` default to `performance.now()` and `Date.now()`. */
export function createPausableClock(
  monotonic: () => number = () => performance.now(),
  epoch: () => number = () => Date.now(),
): PausableClock {
  let paused = 0;
  let pausedAt: number | undefined;
  return {
    now: () => (pausedAt ?? monotonic()) - paused,
    epoch,
    pause() {
      pausedAt ??= monotonic();
    },
    resume() {
      if (pausedAt === undefined) return;
      paused += monotonic() - pausedAt;
      pausedAt = undefined;
    },
  };
}
