/**
 * The video recorder: records a `MediaStream` the caller captured (a screen, a tab or a window)
 * with `MediaRecorder`, as WebM (VP9, then VP8, with Opus) when the browser can, MP4 (H.264 and
 * AAC) otherwise. Chunks reach a sink while recording, so they can be uploaded in parts.
 */

/**
 * The video bitrate at 2560x1440, in bits per second; other sizes scale by their pixel count.
 * An estimate, to be measured against text legibility and file size.
 */
export const DEFAULT_VIDEO_BITRATE_1440P = 8_000_000;
/** The lowest video bitrate, whatever the size. */
export const MIN_VIDEO_BITRATE = 1_000_000;
export const AUDIO_BITRATE = 128_000;
/** The largest capture: the native resolution, capped at 1440p. */
export const MAX_CAPTURE_WIDTH = 2560;
export const MAX_CAPTURE_HEIGHT = 1440;
export const CAPTURE_FRAME_RATE = 30;
export const DEFAULT_TIMESLICE_MS = 1000;

export interface VideoFormat {
  /** What `MediaRecorder` records, such as `video/webm;codecs=vp9,opus`. */
  mimeType: string;
  container: 'mp4' | 'webm';
  videoCodec: 'h264' | 'vp9' | 'vp8';
  audioCodec: 'aac' | 'opus';
}

/**
 * In order of preference. WebM comes first: Probara makes a WebM seekable when the Vis is
 * finalized (its duration and cue points are added), while an MP4 is kept as recorded. MP4 is for
 * the browsers that cannot record WebM (Safari). `avc1.640032` is H.264 High at level 5.0, which
 * holds 1440p.
 */
const FORMATS: readonly VideoFormat[] = [
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    container: 'webm',
    videoCodec: 'vp9',
    audioCodec: 'opus',
  },
  {
    mimeType: 'video/webm;codecs=vp8,opus',
    container: 'webm',
    videoCodec: 'vp8',
    audioCodec: 'opus',
  },
  {
    mimeType: 'video/mp4;codecs=avc1.640032,mp4a.40.2',
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
  },
  {
    mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
  },
];

/** The first format the browser can record, or `null` when it can record none. */
export function pickVideoFormat(
  isTypeSupported: (mimeType: string) => boolean = (type) => MediaRecorder.isTypeSupported(type),
): VideoFormat | null {
  for (const format of FORMATS) {
    try {
      if (isTypeSupported(format.mimeType)) return { ...format };
    } catch {
      return null;
    }
  }
  return null;
}

export interface DisplayCaptureOptions {
  /** Also capture the tab or system audio. Default `false`. */
  audio?: boolean;
}

/** The `getDisplayMedia` options of the quality target: the native resolution up to 2560x1440, at 30 fps. */
export function displayCaptureConstraints(
  options: DisplayCaptureOptions = {},
): DisplayMediaStreamOptions {
  return {
    video: {
      width: { max: MAX_CAPTURE_WIDTH },
      height: { max: MAX_CAPTURE_HEIGHT },
      frameRate: { ideal: CAPTURE_FRAME_RATE, max: CAPTURE_FRAME_RATE },
    },
    audio: options.audio ?? false,
  };
}

/**
 * The video bitrate for a capture of `width` x `height`: `bitrateAt1440p` scaled by the pixel
 * count, between `MIN_VIDEO_BITRATE` and `bitrateAt1440p`. An unknown size gets `bitrateAt1440p`.
 */
export function videoBitrate(
  width: number,
  height: number,
  bitrateAt1440p: number = DEFAULT_VIDEO_BITRATE_1440P,
): number {
  if (!(width > 0) || !(height > 0)) return bitrateAt1440p;
  const scaled = (bitrateAt1440p * width * height) / (MAX_CAPTURE_WIDTH * MAX_CAPTURE_HEIGHT);
  return Math.round(Math.min(bitrateAt1440p, Math.max(MIN_VIDEO_BITRATE, scaled)));
}

/** Why a recording stopped. */
export type VideoStopReason = 'stopped' | 'max_duration' | 'track_ended' | 'error';

/** Gets each chunk, in order, while recording; may return a promise (an upload). */
export type VideoChunkSink = (chunk: Blob, index: number) => void | Promise<void>;

export interface VideoRecorderOptions {
  /** Gets the chunks; without one, the recorder keeps them and the result holds the whole video. */
  sink?: VideoChunkSink;
  /** Stops by itself after this much recorded time (paused time not counted), such as the plan's limit. */
  maxDurationMs?: number;
  /** The video bitrate at 1440p; `DEFAULT_VIDEO_BITRATE_1440P` unless given. */
  bitrateAt1440p?: number;
  /** How often a chunk is produced. */
  timesliceMs?: number;
}

export interface VideoRecordingResult extends Omit<VideoFormat, 'audioCodec'> {
  /** Absent when the stream had no audio track. */
  audioCodec?: VideoFormat['audioCodec'];
  /** Bytes recorded. */
  size: number;
  /** Recorded time in milliseconds, paused time excluded. */
  durationMs: number;
  reason: VideoStopReason;
  /** How many chunks were produced. */
  chunks: number;
  /** The whole video, when no sink was given. */
  blob?: Blob;
  /** The first error a sink threw or rejected with; the recording went on. */
  sinkError?: unknown;
}

export type VideoRecorderState = 'inactive' | 'recording' | 'paused' | 'stopped';

export interface VideoRecorder {
  readonly state: VideoRecorderState;
  readonly format: VideoFormat;
  start(): void;
  pause(): void;
  resume(): void;
  /** Stops recording; resolves with the result once the last chunk reached the sink. */
  stop(): Promise<VideoRecordingResult>;
  /** Resolves with the result however the recording stops. */
  readonly result: Promise<VideoRecordingResult>;
}

const now = (): number => performance.now();

/**
 * A recorder of `stream`. Throws a `TypeError` when the stream has no video track or the
 * browser can record none of the formats.
 */
export function createVideoRecorder(
  stream: MediaStream,
  options: VideoRecorderOptions = {},
): VideoRecorder {
  const found = stream.getVideoTracks()[0];
  if (found === undefined) throw new TypeError('the stream has no video track');
  const picked = pickVideoFormat();
  if (picked === null) throw new TypeError('this browser can record neither MP4 nor WebM');
  const track: MediaStreamTrack = found;
  const format: VideoFormat = picked;
  const hasAudio = stream.getAudioTracks().length > 0;
  const settings = track.getSettings();
  const media = new MediaRecorder(stream, {
    mimeType: format.mimeType,
    videoBitsPerSecond: videoBitrate(
      settings.width ?? 0,
      settings.height ?? 0,
      options.bitrateAt1440p,
    ),
    audioBitsPerSecond: AUDIO_BITRATE,
  });

  let state: VideoRecorderState = 'inactive';
  let reason: VideoStopReason | undefined;
  let size = 0;
  let chunks = 0;
  let recordedMs = 0;
  let runningSince: number | undefined;
  let limitTimer: ReturnType<typeof setTimeout> | undefined;
  let sinkError: unknown;
  let sinkFailed = false;
  const kept: Blob[] = [];
  const deliveries: Promise<void>[] = [];
  let resolve: (result: VideoRecordingResult) => void = () => undefined;
  const result = new Promise<VideoRecordingResult>((done) => {
    resolve = done;
  });

  function holdClock(): void {
    if (runningSince !== undefined) recordedMs += now() - runningSince;
    runningSince = undefined;
    if (limitTimer !== undefined) clearTimeout(limitTimer);
    limitTimer = undefined;
  }

  function runClock(): void {
    runningSince = now();
    const max = options.maxDurationMs;
    if (max !== undefined) {
      limitTimer = setTimeout(
        () => {
          finish('max_duration');
        },
        Math.max(0, max - recordedMs),
      );
    }
  }

  function failSink(error: unknown): void {
    if (sinkFailed) return;
    sinkFailed = true;
    sinkError = error;
  }

  function settle(): void {
    track.removeEventListener('ended', onEnded);
    const out: VideoRecordingResult = {
      mimeType: format.mimeType,
      container: format.container,
      videoCodec: format.videoCodec,
      size,
      durationMs: Math.round(recordedMs),
      reason: reason ?? 'stopped',
      chunks,
    };
    if (hasAudio) out.audioCodec = format.audioCodec;
    if (options.sink === undefined) out.blob = new Blob(kept, { type: format.mimeType });
    if (sinkFailed) out.sinkError = sinkError;
    resolve(out);
  }

  function finish(why: VideoStopReason): void {
    if (state === 'stopped') return;
    reason ??= why;
    const wasStarted = state !== 'inactive';
    holdClock();
    state = 'stopped';
    if (!wasStarted || media.state === 'inactive') {
      void Promise.allSettled(deliveries).then(settle);
      return;
    }
    media.stop();
  }

  function onEnded(): void {
    finish('track_ended');
  }

  media.addEventListener('dataavailable', (event) => {
    const chunk = event.data;
    if (chunk.size === 0) return;
    const index = chunks;
    chunks += 1;
    size += chunk.size;
    if (options.sink === undefined) {
      kept.push(chunk);
      return;
    }
    try {
      const delivery = options.sink(chunk, index);
      if (delivery !== undefined) deliveries.push(Promise.resolve(delivery).catch(failSink));
    } catch (error) {
      failSink(error);
    }
  });
  media.addEventListener('stop', () => {
    // The browser stopped by itself (every track ended): record why.
    if (state !== 'stopped') {
      reason ??= 'track_ended';
      holdClock();
      state = 'stopped';
    }
    void Promise.allSettled(deliveries).then(settle);
  });
  media.addEventListener('error', () => {
    reason ??= 'error';
  });
  track.addEventListener('ended', onEnded);

  return {
    get state() {
      return state;
    },
    format: { ...format },
    result,
    start() {
      if (state !== 'inactive') return;
      media.start(options.timesliceMs ?? DEFAULT_TIMESLICE_MS);
      state = 'recording';
      runClock();
    },
    pause() {
      if (state !== 'recording') return;
      media.pause();
      holdClock();
      state = 'paused';
    },
    resume() {
      if (state !== 'paused') return;
      media.resume();
      state = 'recording';
      runClock();
    },
    stop() {
      finish('stopped');
      return result;
    },
  };
}
