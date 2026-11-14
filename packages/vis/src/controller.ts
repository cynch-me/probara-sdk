/**
 * The recording controller: one visitor's recording through a recording link, from reading the
 * link to a finalized Vis. It drives the engine (the video recorder, the recording session and the
 * captures) and the intake, and it aborts the submission on every ending but a finished one:
 * discard, a failed part, a failed start of the upload, a refusal at finalize, a failed recorder
 * and the page unloading. What only a browser has comes in through `ControllerDeps`.
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
  type RecordingLink,
  type Submission,
  type SubmissionStart,
} from './intake.js';
import { createPartUploader, type PartUploader } from './parts.js';

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
  /** The recording ended; the rest is being uploaded and the Vis finalized. */
  | 'sending'
  /** The Vis was finalized. */
  | 'done'
  /** The recording could not be sent; its submission was aborted. */
  | 'failed'
  /** The recorder was closed. */
  | 'closed';

export interface RecorderSnapshot {
  state: RecorderState;
  link: RecordingLink | null;
  /** The title the Vis will have; the visitor may change it before recording. */
  title: string;
  microphone: boolean;
  /** The longest recording, from the plan; 0 until the link is read. */
  maxDurationMs: number;
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
}

export interface RecordingController {
  snapshot(): RecorderSnapshot;
  /** Recorded time so far, paused time excluded, never above the limit. */
  elapsedMs(): number;
  load(): Promise<void>;
  setTitle(title: string): void;
  setMicrophone(on: boolean): void;
  record(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
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
  };
  let attempt: Attempt | undefined;

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

  async function finish(current: Attempt, result: VideoRecordingResult): Promise<void> {
    if (current.settled || current.finishing === true) return;
    current.finishing = true;
    if (result.reason === 'error' || current.uploader?.error !== undefined) {
      await end(current, 'failed');
      return;
    }
    setState('sending');
    halt(current);
    const submission = current.submission;
    const uploader = current.uploader;
    const uploadUlid = current.uploadUlid;
    const session = current.session;
    try {
      if (submission === undefined || uploader === undefined || uploadUlid === undefined)
        throw new Error('nothing to send');
      await uploader.finish();
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
          current.uploader?.add(chunk);
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
      await end(current, refusalState(error));
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
    void video.result.then((result) => finish(current, result));
    setState('recording');
  }

  return {
    snapshot: () => ({ ...snapshot }),
    elapsedMs() {
      const session = attempt?.session;
      if (session === undefined) return 0;
      return Math.min(session.stamp().t, snapshot.maxDurationMs);
    },
    async load() {
      if (snapshot.state === 'closed') return;
      snapshot.state = 'loading';
      emit();
      try {
        const link = await deps.intake.readLink(deps.query);
        snapshot.link = link;
        snapshot.title = link.title;
        snapshot.microphone = link.microphone;
        snapshot.maxDurationMs = link.recordingMaxMinutes * 60_000;
        setState(link.recordingMaxMinutes > 0 ? 'ready' : 'unavailable');
      } catch (error) {
        setState(refusalState(error));
      }
    },
    setTitle(title) {
      snapshot.title = title;
    },
    setMicrophone(on) {
      snapshot.microphone = on;
    },
    async record() {
      if (snapshot.state !== 'ready' || attempt !== undefined) return;
      const current: Attempt = { cancelled: false, settled: false };
      attempt = current;
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
      await finish(current, result);
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
}
