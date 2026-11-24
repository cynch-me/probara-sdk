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

| Option       | Default      | Meaning                                                                                  |
| ------------ | ------------ | ---------------------------------------------------------------------------------------- |
| `mode`       | required     | `rolling`: an instant replay of the last minutes; `full`: everything from `start()`      |
| `checkoutMs` | `120000`     | Rolling mode only: the length of a segment (`REPLAY_CHECKOUT_MS`).                       |
| `lookbackMs` | `checkoutMs` | Rolling mode only: how far back the replay reaches at least, within `maxSize`.           |
| `maxSize`    | 16 MiB       | Rolling mode only: the most the replay holds, in characters of JSON (`REPLAY_MAX_SIZE`). |
| `blur`       | none         | A blur controller ([recording.md](recording.md)): what it blurs is blocked.              |
| `budget`     | none         | Pauses while the page stays busy for the replay ([below](#pause-on-a-busy-page)).        |

In `rolling` mode a new segment starts with a full snapshot every `checkoutMs`, and the replay
keeps the newest segments that reach back `lookbackMs`: `events()` always starts with a full
snapshot and covers from `lookbackMs` to `lookbackMs` plus one segment, so two to four minutes by
default. A busy page can fill `maxSize` sooner: the oldest segments are then dropped, and a segment
that holds more than half of `maxSize`, more changes than snapshot, starts a new one early, so the
replay holds between half of `maxSize` and all of it. `events()` stays readable after `stop()`;
`start()` again begins a new recording with an empty buffer.

To store the events, write them as NDJSON and gzip them, as the diagnostics are.

## Pause on a busy page

A replay that runs all the time can pause on a page that keeps it busy, instead of stopping. A
pause only pays while the page stays busy: resuming costs a full snapshot, about 190 ms for a
35,000-node table, and the burst of a navigation is over before a pause would save anything.

With `budget`, `{ windowMs, mainThreadMs, busyWindows, pauseMs }`, the replay counts its
main-thread time on DOM changes (rrweb's work on each mutation batch and its own serialization, as
in [health](#health)) in consecutive windows of `windowMs`, full snapshots left out. Once it spent
more than `mainThreadMs` in each of `busyWindows` windows in a row, it pauses: `paused` turns
`true` (`active` stays `true`), the events go on with a custom event,
`{ tag: 'probara/replay-paused', payload: { reason: 'busy', windowMs, busyWindows, mainThreadMs, resumeWithinMs } }`
(`REPLAY_PAUSED_TAG`, `ReplayPause`), and nothing is recorded until the replay resumes from a new
full snapshot.

While paused, the replay still weighs the page's changes by the nodes they add or remove, which
costs it next to nothing, and prices them at what it spent per node while busy. It resumes at the
end of the first window whose changes fit `mainThreadMs`, or `resumeWithinMs` after the pause at
the latest: `pauseMs` for the first pause, twice as long for each pause that follows, up to
`checkoutMs`; a whole `checkoutMs` recorded without a pause starts over from `pauseMs`. So a page
that is always busy costs at most one full snapshot per checkout interval, and the replay never
turns off. A player shows the page as it was when the replay paused until the full snapshot it
resumes from.

`REPLAY_BUDGET` (three windows of 2 s in a row over 100 ms each, then a pause of 10 s at most) is
the budget `@probara/vis` uses for its instant replay. Opening a 200-row Angular order list cost
rrweb 87 ms once, and opening a 35,000-node asset list a few seconds later never pauses it; a page
re-rendering a 6,000-cell table every 400 ms costs it about 60 ms each time, and pauses it in its
third window, about 4.5 s in.

```ts
const replay = createReplayRecorder({ mode: 'rolling', blur, budget: REPLAY_BUDGET });
```

## Health

A replay measures itself from `start()`. `health` is a copy of what it measured, and `coverage`
gives the timestamps of the first and the last event held without reading the events (`null`
before the first full snapshot):

| Field               | Meaning                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `pauses`            | How many times it paused on a busy page                                                   |
| `checkouts`         | Full snapshots taken, the first one included                                              |
| `size`              | The size of the events held                                                               |
| `recordedSize`      | The size of every event recorded, the dropped ones included                               |
| `largestBatch`      | The largest DOM mutation batch: `records`, `size` and `ms`, rrweb's time on it, or `null` |
| `longestSnapshotMs` | The longest full snapshot                                                                 |
| `mainThreadMs`      | rrweb's time on every mutation batch and full snapshot, plus the recorder's own           |

Sizes are lengths of the events' JSON text, in characters (bytes for ASCII). Times are
main-thread milliseconds. `replayHealthEvent(health, timestamp)` turns it into a custom event,
`{ tag: 'probara/replay-health', payload: health }` (`REPLAY_HEALTH_TAG`); `@probara/vis` ends
every instant replay it sends with one, stamped at the moment the replay was taken, so the console
and network entries logged after the last change still fall inside what plays.

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
  held before the element was blurred stays in them;
- HTML comments, such as the anchors frameworks leave around templates: a node inserted next to
  one still replays in its place.
