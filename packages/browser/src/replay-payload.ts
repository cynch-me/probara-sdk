import type { CaptureReplayEvent, CaptureSnapshot } from '@probara/vis-capture';

const CUSTOM_EVENT = 5;

type StreamEntry =
  | CaptureSnapshot['console'][number]
  | CaptureSnapshot['network'][number]
  | CaptureSnapshot['userEvents'][number];

export type ReplayStreamTag = 'probara.console' | 'probara.network' | 'probara.events';

export interface ReplayStreamLine extends CaptureReplayEvent {
  type: typeof CUSTOM_EVENT;
  data: { tag: ReplayStreamTag; payload: StreamEntry };
}

export function replayLines(snapshot: CaptureSnapshot): (CaptureReplayEvent | ReplayStreamLine)[] {
  const start = snapshot.events[0]?.timestamp;
  if (start === undefined) return [];
  const tagged = (tag: ReplayStreamTag, entries: readonly StreamEntry[]): ReplayStreamLine[] =>
    entries
      .filter((entry) => entry.ts >= start)
      .map((entry) => ({ type: CUSTOM_EVENT, timestamp: entry.ts, data: { tag, payload: entry } }));
  return [
    ...snapshot.events,
    ...tagged('probara.console', snapshot.console),
    ...tagged('probara.network', snapshot.network),
    ...tagged('probara.events', snapshot.userEvents),
  ].sort((a, b) => a.timestamp - b.timestamp);
}
