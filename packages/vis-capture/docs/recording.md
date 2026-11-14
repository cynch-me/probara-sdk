# Video recording and blur

## Capture the screen

Capturing the screen, a tab or a window is the caller's job; `displayCaptureConstraints()` gives
the `getDisplayMedia` options of the quality target: the native resolution up to 2560x1440, at
30 frames per second.

```ts
import { createVideoRecorder, displayCaptureConstraints } from '@probara/vis-capture';

const stream = await navigator.mediaDevices.getDisplayMedia(
  displayCaptureConstraints({ audio: true }),
);
const video = createVideoRecorder(stream, {
  sink: (chunk, index) => uploadPart(index, chunk), // may return a promise
  maxDurationMs: 30 * 60_000, // the plan's limit
});
video.start();
// video.pause(); video.resume();
const result = await video.stop(); // or: await video.result, however it stopped
```

`createVideoRecorder` throws a `TypeError` when the stream has no video track or the browser can
record none of the formats. It records MP4 (H.264 and AAC) when the browser can, otherwise WebM
(VP9, then VP8, with Opus); `pickVideoFormat()` gives the choice and `video.format` holds it.

| Option           | Default | Meaning                                                                    |
| ---------------- | ------- | -------------------------------------------------------------------------- |
| `sink`           | none    | Gets each chunk and its index, in order, while recording.                  |
| `maxDurationMs`  | none    | Stops by itself after this much recorded time; paused time does not count. |
| `bitrateAt1440p` | 8 Mbps  | The video bitrate at 2560x1440 (`DEFAULT_VIDEO_BITRATE_1440P`).            |
| `timesliceMs`    | `1000`  | How often a chunk is produced.                                             |

The video bitrate scales with the captured size's pixel count (`videoBitrate(width, height)`),
never under 1 Mbps nor over the 1440p figure. The 8 Mbps default is an estimate still to be
measured against text legibility and file size.

The result holds `mimeType`, `container`, `videoCodec`, `audioCodec` (absent without an audio
track), `size` in bytes, `durationMs` without paused time, `chunks`, and `reason`:

| `reason`       | When                                                   |
| -------------- | ------------------------------------------------------ |
| `stopped`      | `stop()` was called                                    |
| `max_duration` | `maxDurationMs` was reached                            |
| `track_ended`  | the video track ended: the user clicked "Stop sharing" |
| `error`        | the browser's recorder failed                          |

`stop()` resolves once every chunk reached the sink and every promise it returned settled. A sink
that throws or rejects does not stop the recording: the first such error is in `sinkError`.
Without a sink, the chunks are kept in memory and `blob` holds the whole video.

## Blur

```ts
import { createBlurController } from '@probara/vis-capture';

const blur = createBlurController();
blur.blur(document.querySelector('#card')!); // one element
blur.blur('.customer-email'); // every element the selector matches, also those added later
blur.unblur('.customer-email');
blur.stop(); // unblurs everything
```

Blurred elements render blurred in the page (a CSS `filter`), so a screen recording shows them
blurred. Pass the controller as `blur` to the user event capture and the replay recorder: user
events never take the text of a blurred element, and the replay blocks it. An element is marked
with the `data-probara-blur` attribute; `selector` is one CSS selector matching everything blurred,
`isBlurred(element)` tells whether an element or one of its ancestors is, and `subscribe(listener)`
calls back after each change. A selector that is not valid CSS throws a `TypeError`.

The blur is applied through the CSSOM (an inline style property and a constructed stylesheet),
which a Content Security Policy does not block. `stop()` puts back the inline `filter` each element
had.
