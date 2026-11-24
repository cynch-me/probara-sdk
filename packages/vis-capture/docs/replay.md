# DOM replay

The replay lives in its own entry, so a page that records no replay never loads
the recorder of [rrweb](https://github.com/rrweb-io/rrweb) (`@rrweb/record`, MIT) it is built on:

```ts
import { createReplayRecorder } from '@probara/vis-capture/replay';
```

```html
<!-- Sets the global ProbaraVisCaptureReplay; the rrweb recorder is bundled in. -->
<script src="https://cdn.jsdelivr.net/npm/@probara/vis-capture/dist/vis-capture-replay.iife.js"></script>
```

## Record

```ts
const replay = createReplayRecorder({ mode: 'rolling', blur });
replay.start();
// ... later, when the user reports the bug:
const events = replay.events(); // rrweb events, oldest first
replay.stop();
```

| Option          | Default  | Meaning                                                                                    |
| --------------- | -------- | ------------------------------------------------------------------------------------------ |
| `mode`          | required | `rolling`: an instant replay of the last minutes; `full`: everything from `start()`        |
| `checkoutMs`    | `120000` | Rolling mode only: the length of a segment (`REPLAY_CHECKOUT_MS`).                         |
| `blur`          | none     | A blur controller ([recording.md](recording.md)): what it blurs is blocked.                |
| `mutationLimit` | none     | Stops recording past this many DOM mutation records in a segment (in `full` mode, in all). |

In `rolling` mode a new segment starts with a full snapshot every `checkoutMs`, and only the
current and the previous segment are kept: `events()` always starts with a full snapshot and
covers between one and two segments, so up to four minutes by default. `events()` stays readable
after `stop()`; `start()` again begins a new recording with an empty buffer.

To store the events, write them as NDJSON and gzip them, as the diagnostics are.

## Stop on a busy page

A replay that runs all the time can stop itself on a page that changes too much. With
`mutationLimit`, once a segment holds more DOM mutation records than that (nodes added or removed,
texts and attributes changed), the recorder stops: `active` turns `false`, `stopReason` is
`'mutation_limit'`, and the events end with a custom event,
`{ tag: 'probara/replay-stopped', payload: { reason: 'mutation_limit', limit } }`
(`REPLAY_STOPPED_TAG`). What it held stays readable; `start()` begins again with no stop reason.
`REPLAY_MUTATION_LIMIT` (10,000) is the limit `@probara/vis` uses for its instant replay, an
assumption still to settle by measurement.

```ts
const replay = createReplayRecorder({
  mode: 'rolling',
  blur,
  mutationLimit: REPLAY_MUTATION_LIMIT,
});
```

## Health

A replay measures itself from `start()`. `health` is a copy of what it measured, and `coverage`
gives the timestamps of the first and the last event held without reading the events (`null`
before the first full snapshot):

| Field               | Meaning                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `stopReason`        | Why it stopped by itself, or `null`                                                       |
| `checkouts`         | Full snapshots taken, the first one included                                              |
| `size`              | The size of the events held                                                               |
| `recordedSize`      | The size of every event recorded, the dropped ones included                               |
| `largestBatch`      | The largest DOM mutation batch: `records`, `size` and `ms`, rrweb's time on it, or `null` |
| `longestSnapshotMs` | The longest full snapshot                                                                 |
| `mainThreadMs`      | rrweb's time on every mutation batch and full snapshot, plus the recorder's own           |

Sizes are lengths of the events' JSON text, in characters (bytes for ASCII). Times are
main-thread milliseconds. `replayHealthEvent(health, timestamp)` turns it into a custom event,
`{ tag: 'probara/replay-health', payload: health }` (`REPLAY_HEALTH_TAG`); `@probara/vis` ends
every instant replay it sends with one, stamped at the replay's last event so it never lengthens
what plays.

```ts
const events = [
  ...replay.events(),
  replayHealthEvent(replay.health, replay.coverage?.to ?? Date.now()),
];
```

## What is never recorded

- every input value is masked (`*`), including what is typed after the start;
- the text of editable elements (`contenteditable`) and of everything inside them is masked
  (`*`), from the first snapshot on and including what is typed into them later;
- password fields are blocked whole: neither their value nor its length is recorded;
- elements blurred with the blur controller are blocked: the replay shows an empty box of their
  size. rrweb reads what to block when it starts, so when the blur changes during a recording the
  recorder starts over from a new full snapshot that blocks it; what the earlier events already
  held before the element was blurred stays in them.
