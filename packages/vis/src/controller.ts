/**
 * The recording controller: one visitor's recording through a recording link, from reading the
 * link to a finalized Vis. It drives the engine (the video recorder, the recording session and the
 * captures) and the intake, and it aborts the submission on every ending but a finished one:
 * discard (while recording or while the recording is watched, as recording again does), a failed
 * part, a failed start of the upload, a refusal at finalize, a failed recorder and the page
 * unloading. A stopped recording is kept in the page to be watched while its parts go on
 * uploading; the upload is completed and the Vis finalized only when the visitor sends it. What
 * only a browser has comes in through `ControllerDeps`.
 */
import {
  createRecordingSession,
  type CapturedEnvironment,
  type DiagnosticsStream,
  type RecordingSession,
  type VideoRecorder,
  type VideoRecorderOptions,
  type VideoRecordingResult,
  type VisMetadata,
} from '@probara/vis-capture';
import { createPausableClock, type PausableClock } from './clock.js';
import {
  IntakeError,
  type Intake,
  type LinkQuery,
  type Refusal,
  type RecordingLink,
  type Submission,
  type SubmissionStart,
} from './intake.js';
import { createPartUploader, type PartUploader } from './parts.js';
import { withWebmDuration } from './webm-duration.js';

export type RecorderState =
  /** Reading the link. */
  | 'loading'
  /** The link is unknown, revoked, expired or used, or the plan allows no recording. */
  | 'unavailable'
  /** Too many recordings at once, or too many requests: try again later. */
  | 'busy'
  /** Ready to record. */
  | 'ready'
  /** The visitor is choosing what to share; the submission is being started. */
  | 'starting'
  | 'recording'
  | 'paused'
  /**
   * The recording ended and is kept in the page to be watched; its parts go on uploading, and
   * nothing is final until the visitor sends it, records again or discards it.
   */
  | 'review'
  /** The visitor sent the recording; the rest is being uploaded and the Vis finalized. */
  | 'sending'
  /** The Vis was finalized. */
  | 'done'
  /** The recording could not be sent; its submission was aborted. */
  | 'failed'
  /** The recorder was closed. */
  | 'closed'
  /** This browser cannot record the screen (a phone, for one): nothing was started. */
  | 'unsupported';

/**
 * Why a recording stopped by itself: `size_limit` when the video was about to outgrow the largest
 * upload, `time_limit` when it reached the plan's longest recording.
 */
export type StopReason = 'size_limit' | 'time_limit';

export interface RecorderSnapshot {
  state: RecorderState;
  link: RecordingLink | null;
  /** The title the Vis will have: the link's, or the one the page gave; the visitor never edits it. */
  title: string;
  microphone: boolean;
  /** The longest recording, from the plan; 0 until the link is read. */
  maxDurationMs: number;
  /** Why the last recording stopped by itself; `null` when the visitor stopped it. */
  stopReason: StopReason | null;
  /** The whole recording, to be watched before it is sent: set only in `review`. */
  recording: Blob | null;
  /**
   * The link got no answer, and the page is on another origin than the API: the intake likely
   * refused the page's origin (a browser shows a refused CORS request as no answer).
   */
  originRefused: boolean;
  /** Why the widget intake refused the report; always `null` for a recording link. */
  refusal: Refusal | null;
}

/** The shared screen, and how to stop sharing it. */
export interface MediaCapture {
  stream: MediaStream;
  release(): void;
}

export interface ControllerDeps {
  intake: Intake;
  /** The link's URL parameters for this recording. */
  query: LinkQuery;
  /** Whether the page is on another origin than the API. */
  crossOrigin: boolean;
  /** Asks the visitor what to share (and the microphone); rejects when they cancel. */
  acquireMedia(options: { microphone: boolean }): Promise<MediaCapture>;
  createVideoRecorder(stream: MediaStream, options: VideoRecorderOptions): VideoRecorder;
  /** Starts the console, network and user event captures into the session. */
  startCaptures(session: RecordingSession): { stop(): void };
  collectEnvironment(): Promise<CapturedEnvironment>;
  collectMetadata(): VisMetadata | null;
  gzip(entries: readonly object[]): Promise<Uint8Array<ArrayBuffer>>;
  /** Epoch milliseconds. */
  epoch(): number;
  /** Monotonic milliseconds. */
  monotonic(): number;
  onChange(snapshot: RecorderSnapshot): void;
  /** Names the refusals of a widget intake; a recording link has none. */
  refusalOf?: (error: unknown) => Refusal | null;
}

export interface RecordingController {
  snapshot(): RecorderSnapshot;
  /** Recorded time so far, paused time excluded, never above the limit. */
  elapsedMs(): number;
  load(): Promise<void>;
  setMicrophone(on: boolean): void;
  record(): Promise<void>;
  pause(): void;
  resume(): void;
  /** Ends the recording: it is kept to be watched, and its parts go on uploading. */
  stop(): Promise<void>;
  /** Sends the recording watched: the upload is completed and the Vis finalized. */
  send(): Promise<void>;
  /** Throws the watched recording away (its submission is aborted) and starts a new one at once. */
  recordAgain(): Promise<void>;
  /** Throws the recording away, while recording or while it is watched, and aborts its submission. */
  discard(): Promise<void>;
  /** Discards any recording in progress and closes. */
  close(): void;
  /** The page is going away: abort what is open with a request that outlives it, and close. */
  pageHidden(): void;
}

/** The longest title a Vis takes. */
const MAX_TITLE_LENGTH = 200;
const STREAMS: readonly DiagnosticsStream[] = ['console', 'network', 'events'];

/** One attempt at recording: everything that must be undone when it ends early. */
interface Attempt {
  cancelled: boolean;
  /** Ended one way or another: nothing more to finish or abort. */
  settled: boolean;
  media?: MediaCapture | undefined;
  video?: VideoRecorder;
  submission?: Submission;
  uploadUlid?: string;
  uploader?: PartUploader;
  session?: RecordingSession;
  captures?: { stop(): void } | undefined;
  clock?: PausableClock;
  aborted?: boolean;
  /** The video ended and its upload is being finished. */
  finishing?: boolean;
  /** The video stops once it holds this many bytes: one part below the largest upload. */
  stopAtBytes?: number;
  /** The video was stopped at the size limit. */
  capped?: boolean;
  /** Every chunk recorded, in order: the copy watched before sending. */
  chunks: Blob[];
  /** The ended video, kept while it is watched. */
  result?: VideoRecordingResult;
  /** The upload of every part, the last included, started once the video ended. */
  uploaded?: Promise<unknown>;
}

/** Whether the link got no answer at all (a refused cross-origin request looks the same). */
function unanswered(error: unknown): boolean {
  return error instanceof IntakeError && error.status === null && error.code === 'network';
}

/** The state a refusal of the intake shows. */
function refusalState(error: unknown): RecorderState {
  if (error instanceof IntakeError) {
    // Unknown, revoked, expired or used, or a URL parameter it refuses (a private folder).
    if (error.status === 404 || error.status === 422) return 'unavailable';
    if (error.status === 429) return 'busy';
  }
  return 'failed';
}

export function createRecordingController(deps: ControllerDeps): RecordingController {
  const snapshot: RecorderSnapshot = {
    state: 'loading',
    link: null,
    title: '',
    microphone: false,
    maxDurationMs: 0,
    stopReason: null,
    recording: null,
    originRefused: false,
    refusal: null,
  };
  let attempt: Attempt | undefined;

  /** The state a refusal shows, naming the widget's reason when there is one. */
  function refuse(error: unknown): RecorderState {
    const refusal = deps.refusalOf?.(error) ?? null;
    snapshot.refusal = refusal;
    if (refusal === 'reporter_required' || refusal === 'invalid_reporter') return 'unavailable';
    return refusalState(error);
  }

  function emit(): void {
    try {
      deps.onChange({ ...snapshot });
    } catch {
      // A listener never breaks the recording.
    }
  }

  function setState(state: RecorderState): void {
    if (snapshot.state === state || snapshot.state === 'closed') return;
    snapshot.state = state;
    // The recording is kept in the page only while it is watched.
    if (state !== 'review') snapshot.recording = null;
    emit();
  }

  /** Stops what records: the captures, the session, the video and the shared screen. */
  function halt(current: Attempt): void {
    try {
      current.captures?.stop();
    } catch {
      // Already stopped.
    }
    current.captures = undefined;
    current.session?.stop();
    const video = current.video;
    if (video !== undefined && (video.state === 'recording' || video.state === 'paused')) {
      void video.stop().catch(() => undefined);
    }
    try {
      current.media?.release();
    } catch {
      // Already released.
    }
    current.media = undefined;
  }

  /** Abandons the submission, once, when there is one. */
  async function abort(current: Attempt, keepalive = false): Promise<void> {
    if (current.submission === undefined || current.aborted === true) return;
    current.aborted = true;
    try {
      await current.submission.abort({ keepalive });
    } catch {
      // Best effort: an unfinished submission expires on the server.
    }
  }

  /** Ends the attempt early: everything stops and the submission is aborted. */
  async function end(current: Attempt, next: RecorderState): Promise<void> {
    if (current.settled) return;
    current.settled = true;
    current.cancelled = true;
    halt(current);
    if (attempt === current) attempt = undefined;
    setState(next);
    await abort(current);
  }

  // Read through functions: another call may change them while this one awaits.
  const isSettled = (current: Attempt): boolean => current.settled;
  const isCancelled = (current: Attempt): boolean => current.cancelled;

  function clamp(durationMs: number): number {
    return Math.max(1, Math.min(Math.round(durationMs), snapshot.maxDurationMs));
  }

  /** The video ended: it is kept to be watched while its parts go on uploading. */
  function finish(current: Attempt, result: VideoRecordingResult): void {
    if (current.settled || current.finishing === true) return;
    current.finishing = true;
    if (result.reason === 'error' || current.uploader?.error !== undefined) {
      void end(current, 'failed');
      return;
    }
    if (result.reason === 'max_duration' && snapshot.stopReason === null) {
      snapshot.stopReason = 'time_limit';
    }
    halt(current);
    current.result = result;
    // A failed upload ends the attempt through the uploader's `onError`.
    current.uploaded = current.uploader?.finish() ?? Promise.reject(new Error('nothing to send'));
    current.uploaded.catch(() => end(current, 'failed'));
    const container = current.video?.format.container ?? 'webm';
    const type = `video/${container}`;
    const chunks = [...current.chunks];
    // A WebM gets its duration, so it can be scrubbed at once; an MP4 already has one.
    const watched =
      container === 'webm'
        ? withWebmDuration(chunks, result.durationMs, type).catch(() => new Blob(chunks, { type }))
        : Promise.resolve(new Blob(chunks, { type }));
    void watched.then((recording) => {
      // Discarded or failed meanwhile: there is nothing to watch.
      if (isSettled(current) || attempt !== current) return;
      snapshot.recording = recording;
      if (snapshot.state === 'review') emit();
      else setState('review');
    });
  }

  /** Completes the upload, sends the diagnostics and finalizes the Vis. */
  async function send(current: Attempt): Promise<void> {
    if (current.settled || snapshot.state !== 'review') return;
    setState('sending');
    const submission = current.submission;
    const uploadUlid = current.uploadUlid;
    const session = current.session;
    const result = current.result;
    try {
      if (submission === undefined || uploadUlid === undefined || result === undefined)
        throw new Error('nothing to send');
      await current.uploaded;
      if (isSettled(current)) return;
      await submission.complete(uploadUlid);
      for (const stream of STREAMS) {
        const entries = session?.entries(stream) ?? [];
        if (entries.length === 0) continue;
        if (isSettled(current)) return;
        await submission.putAsset(stream, await deps.gzip(entries));
      }
      if (isSettled(current)) return;
      await submission.finalize(clamp(result.durationMs));
      current.settled = true;
      if (attempt === current) attempt = undefined;
      setState('done');
    } catch {
      await end(current, 'failed');
    }
  }

  /**
   * Uploads a chunk of the video, and stops the recording normally one part before the largest
   * upload, as a part past it would fail the whole upload: what was recorded is sent.
   */
  function addChunk(current: Attempt, chunk: Blob): void {
    const uploader = current.uploader;
    if (uploader === undefined) return;
    current.chunks.push(chunk);
    uploader.add(chunk);
    const video = current.video;
    if (
      current.capped === true ||
      current.stopAtBytes === undefined ||
      uploader.error !== undefined ||
      uploader.bytes < current.stopAtBytes ||
      video === undefined ||
      (video.state !== 'recording' && video.state !== 'paused')
    ) {
      return;
    }
    current.capped = true;
    snapshot.stopReason = 'size_limit';
    void video.stop().catch(() => undefined);
  }

  async function begin(current: Attempt): Promise<void> {
    let media: MediaCapture;
    try {
      media = await deps.acquireMedia({ microphone: snapshot.microphone });
    } catch {
      // The visitor cancelled the share, or the browser refused it: nothing was started.
      current.settled = true;
      if (attempt === current) attempt = undefined;
      setState('ready');
      return;
    }
    current.media = media;
    if (current.cancelled) {
      halt(current);
      return;
    }
    let video: VideoRecorder;
    try {
      video = deps.createVideoRecorder(media.stream, {
        maxDurationMs: snapshot.maxDurationMs,
        sink: (chunk) => {
          addChunk(current, chunk);
        },
      });
    } catch {
      await end(current, 'failed');
      return;
    }
    current.video = video;

    const captured = await deps.collectEnvironment();
    const body: SubmissionStart = {};
    const title = snapshot.title.trim().slice(0, MAX_TITLE_LENGTH);
    if (title !== '') body.title = title;
    if (deps.query.reference !== undefined) body.reference = deps.query.reference;
    if (deps.query.folder !== undefined) body.folderUlid = deps.query.folder;
    if (captured.pageUrl !== undefined) body.pageUrl = captured.pageUrl;
    if (captured.pageTitle !== undefined) body.pageTitle = captured.pageTitle;
    body.environment = captured.environment;
    body.capturedAt = deps.epoch();
    const metadata = deps.collectMetadata();
    if (metadata !== null) body.metadata = metadata;
    if (isCancelled(current)) {
      halt(current);
      return;
    }

    try {
      current.submission = await deps.intake.start(body);
    } catch (error) {
      await end(current, refuse(error));
      return;
    }
    if (isCancelled(current)) {
      // Closed while the start was on its way: the submission exists now, so abort it.
      await abort(current);
      return;
    }

    try {
      const upload = await current.submission.createUpload(`video/${video.format.container}`);
      current.uploadUlid = upload.uploadUlid;
      current.stopAtBytes = upload.maxBytes - upload.partSize;
      const submission = current.submission;
      current.uploader = createPartUploader({
        partSize: upload.partSize,
        maxBytes: upload.maxBytes,
        upload: (partNumber, part) => submission.putPart(upload.uploadUlid, partNumber, part),
        onError: () => {
          void end(current, 'failed');
        },
      });
    } catch {
      await end(current, 'failed');
      return;
    }
    if (isCancelled(current)) {
      await abort(current);
      return;
    }

    const clock = createPausableClock(
      () => deps.monotonic(),
      () => deps.epoch(),
    );
    const session = createRecordingSession({ clock });
    current.clock = clock;
    current.session = session;
    session.start();
    try {
      current.captures = deps.startCaptures(session);
    } catch {
      // Diagnostics are best effort; the video goes on.
    }
    try {
      video.start();
    } catch {
      await end(current, 'failed');
      return;
    }
    void video.result.then((result) => {
      finish(current, result);
    });
    setState('recording');
  }

  const controller: RecordingController = {
    snapshot: () => ({ ...snapshot }),
    elapsedMs() {
      const session = attempt?.session;
      if (session === undefined) return 0;
      return Math.min(session.stamp().t, snapshot.maxDurationMs);
    },
    async load() {
      if (snapshot.state === 'closed') return;
      snapshot.state = 'loading';
      snapshot.originRefused = false;
      snapshot.refusal = null;
      emit();
      try {
        const link = await deps.intake.readLink(deps.query);
        snapshot.link = link;
        snapshot.title = link.title;
        snapshot.microphone = link.microphone;
        snapshot.maxDurationMs = link.recordingMaxMinutes * 60_000;
        setState(link.recordingMaxMinutes > 0 ? 'ready' : 'unavailable');
      } catch (error) {
        snapshot.originRefused = deps.crossOrigin && unanswered(error);
        setState(refuse(error));
      }
    },
    setMicrophone(on) {
      snapshot.microphone = on;
    },
    async record() {
      if (snapshot.state !== 'ready' || attempt !== undefined) return;
      const current: Attempt = { cancelled: false, settled: false, chunks: [] };
      attempt = current;
      snapshot.stopReason = null;
      snapshot.refusal = null;
      setState('starting');
      try {
        await begin(current);
      } catch {
        await end(current, 'failed');
      }
    },
    pause() {
      if (snapshot.state !== 'recording' || attempt?.video === undefined) return;
      attempt.video.pause();
      attempt.clock?.pause();
      setState('paused');
    },
    resume() {
      if (snapshot.state !== 'paused' || attempt?.video === undefined) return;
      attempt.video.resume();
      attempt.clock?.resume();
      setState('recording');
    },
    async stop() {
      const current = attempt;
      if (current?.video === undefined) return;
      if (snapshot.state !== 'recording' && snapshot.state !== 'paused') return;
      const result = await current.video.stop();
      finish(current, result);
    },
    async send() {
      const current = attempt;
      if (current !== undefined) await send(current);
    },
    async recordAgain() {
      const current = attempt;
      if (current === undefined || snapshot.state !== 'review') return;
      // The attempt ends at once, so the new one starts in the same gesture (a screen share needs
      // the visitor's click); the abort goes on meanwhile.
      const ended = end(current, 'ready');
      await Promise.all([ended, controller.record()]);
    },
    async discard() {
      const current = attempt;
      if (current === undefined) return;
      await end(current, 'ready');
    },
    close() {
      const current = attempt;
      setState('closed');
      if (current !== undefined) void end(current, 'closed');
    },
    pageHidden() {
      const current = attempt;
      if (current !== undefined && !current.settled) {
        current.settled = true;
        current.cancelled = true;
        halt(current);
        attempt = undefined;
        void abort(current, true);
      }
      setState('closed');
    },
  };
  return controller;
}
