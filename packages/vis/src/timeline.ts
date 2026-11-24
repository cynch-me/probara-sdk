/**
 * An instant replay on the player's timeline: the player starts at the replay's first event and
 * ends at the copy, so every diagnostics entry is counted (`t`) from that first event, from its
 * epoch time, since a held replay and the live one come from sessions that counted from different
 * starts. What happened before the first event has no place on that timeline and is left out.
 */
import type { EntryTime } from '@probara/vis-capture';
import type { Frozen } from './buffers.js';

function placed<T extends EntryTime>(entries: readonly T[], from: number): T[] {
  return entries
    .filter((entry) => entry.ts >= from)
    .map((entry) => ({ ...entry, t: Math.round(entry.ts - from) }));
}

export function onReplayTimeline(frozen: Frozen): { frozen: Frozen; durationMs: number } {
  let from = frozen.at;
  for (const event of frozen.events) from = Math.min(from, event.timestamp);
  return {
    frozen: {
      ...frozen,
      console: placed(frozen.console, from),
      network: placed(frozen.network, from),
      userEvents: placed(frozen.userEvents, from),
    },
    durationMs: Math.max(1, Math.round(frozen.at - from)),
  };
}
