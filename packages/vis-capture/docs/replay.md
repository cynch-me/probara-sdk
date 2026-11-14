# DOM replay

The replay lives in its own entry, so a page that records no replay never loads
[rrweb](https://github.com/rrweb-io/rrweb) (MIT), the recorder it is built on:

```ts
import { createReplayRecorder } from '@probara/vis-capture/replay';
```

```html
<!-- Sets the global ProbaraVisCaptureReplay; rrweb is bundled in. -->
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

| Option       | Default  | Meaning                                                                             |
| ------------ | -------- | ----------------------------------------------------------------------------------- |
| `mode`       | required | `rolling`: an instant replay of the last minutes; `full`: everything from `start()` |
| `checkoutMs` | `120000` | Rolling mode only: the length of a segment (`REPLAY_CHECKOUT_MS`).                  |
| `blur`       | none     | A blur controller ([recording.md](recording.md)): what it blurs is blocked.         |

In `rolling` mode a new segment starts with a full snapshot every `checkoutMs`, and only the
current and the previous segment are kept: `events()` always starts with a full snapshot and
covers between one and two segments, so up to four minutes by default. `events()` stays readable
after `stop()`; `start()` again begins a new recording with an empty buffer.

To store the events, write them as NDJSON and gzip them, as the diagnostics are.

## What is never recorded

- every input value is masked (`*`), including what is typed after the start;
- password fields are blocked whole: neither their value nor its length is recorded;
- elements blurred with the blur controller are blocked: the replay shows an empty box of their
  size. rrweb reads what to block when it starts, so when the blur changes during a recording the
  recorder starts over from a new full snapshot that blocks it; what the earlier events already
  held before the element was blurred stays in them.
