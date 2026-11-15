/**
 * The in-page recorder: when a page is opened with a recording link token, an overlay lets the
 * visitor record the current tab, and the video, the console, network and user events and the
 * environment go to the recording link's intake as a Vis. Everything here runs in the browser;
 * the decisions are in the controller, which the tests drive with fakes.
 */
import {
  collectEnvironment,
  createBlurController,
  createVideoRecorder,
  displayCaptureConstraints,
  gzipNdjson,
  pickVideoFormat,
  type Sanitizers,
  type UrlPattern,
} from '@probara/vis-capture';
import { applyAutoBlur } from './blur.js';
import { startPageCaptures } from './captures.js';
import { createRecordingController, type MediaCapture, type RecorderState } from './controller.js';
import { stringsFor, type Locale } from './i18n.js';
import { createIntake, type IntakeFetch, type LinkQuery } from './intake.js';
import { collectMetadata } from './metadata.js';
import { createOverlay, type Overlay } from './overlay.js';
import { isRecordingToken, takeRecordingToken } from './url.js';

/** The Probara API the recorder sends to unless `apiOrigin` names another. */
const DEFAULT_API_ORIGIN = 'https://app.probara.net';

export interface RecorderOptions extends Sanitizers {
  /**
   * The origin of the Probara API that serves the recording link: `https://app.probara.net`
   * unless given; anything after the origin is ignored. The intake answers pages on the
   * organization's verified recording domains (and on localhost for development).
   */
  apiOrigin?: string;
  /** Overrides the link's title for this recording. The visitor never edits the title. */
  title?: string;
  /** Overrides the link's reference (up to 200 characters). */
  reference?: string;
  /** Overrides the link's folder: the ULID of a folder that is not private. */
  folder?: string;
  /** Overrides whether the microphone starts on. */
  microphone?: boolean;
  /** CSS selectors blurred while recording, on top of the automatic ones. */
  blur?: readonly string[];
  /** Requests left out of the network capture, on top of the intake's own. */
  ignoreUrls?: readonly UrlPattern[];
  /** The language of the overlay: the browser's (`es` or English) unless given. */
  locale?: Locale;
  /** Called on each change of state. */
  onStateChange?: (state: RecorderState) => void;
}

export interface Recorder {
  readonly state: RecorderState;
  /** Closes the recorder; a recording in progress is discarded and its submission aborted. */
  close(): void;
}

/** What the tests replace; not part of the published API. */
export interface RecorderInternals {
  fetch: IntakeFetch;
  acquireMedia: (options: { microphone: boolean }) => Promise<MediaCapture>;
  overlayMode: ShadowRootMode;
  onOverlay: (root: ShadowRoot) => void;
  /** The time limit of every intake request, uploads included. */
  timeoutMs: number;
}

/**
 * Whether this browser can record the tab and send it: screen sharing, `MediaRecorder` with MP4
 * or WebM, `CompressionStream` and shadow DOM. Never throws.
 */
export function isRecordingSupported(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof (navigator.mediaDevices as MediaDevices | undefined)?.getDisplayMedia === 'function' &&
      typeof MediaRecorder === 'function' &&
      typeof CompressionStream === 'function' &&
      typeof Element.prototype.attachShadow === 'function' &&
      pickVideoFormat() !== null
    );
  } catch {
    return false;
  }
}

/** Shares the tab (the browser's picker opens on it), and the microphone when asked and allowed. */
async function acquireDisplay(options: { microphone: boolean }): Promise<MediaCapture> {
  const constraints = {
    ...displayCaptureConstraints(),
    // Chromium: offer this tab first, and let the visitor pick it.
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  } as DisplayMediaStreamOptions;
  const display = await navigator.mediaDevices.getDisplayMedia(constraints);
  let microphone: MediaStream | undefined;
  if (options.microphone) {
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Refused: the recording goes on without it.
    }
  }
  const tracks = [...display.getVideoTracks(), ...(microphone?.getAudioTracks() ?? [])];
  return {
    stream: new MediaStream(tracks),
    release() {
      for (const track of [...display.getTracks(), ...(microphone?.getTracks() ?? [])]) {
        track.stop();
      }
    },
  };
}

interface Active {
  recorder: Recorder;
}

/** The one recorder of the page, while it is open. */
let active: Active | undefined;

function linkQuery(options: RecorderOptions): LinkQuery {
  const query: LinkQuery = {};
  if (options.title !== undefined) query.title = options.title;
  if (options.reference !== undefined) query.reference = options.reference;
  if (options.folder !== undefined) query.folder = options.folder;
  if (options.microphone !== undefined) query.microphone = options.microphone;
  return query;
}

/**
 * The recorder of a browser that cannot record the screen: the overlay says so and closes; no
 * request is sent.
 */
function openUnsupported(
  options: RecorderOptions,
  internals: Partial<RecorderInternals>,
): Recorder {
  let state: RecorderState = 'unsupported';
  const notify = (): void => {
    try {
      options.onStateChange?.(state);
    } catch {
      // A listener never breaks the recorder.
    }
  };
  const close = (): void => {
    if (state === 'closed') return;
    state = 'closed';
    overlay.remove();
    if (active?.recorder === recorder) active = undefined;
    notify();
  };
  const ignore = (): void => undefined;
  const overlay = createOverlay(
    document,
    stringsFor(options.locale),
    {
      onMicrophone: ignore,
      onRecord: ignore,
      onPause: ignore,
      onResume: ignore,
      onStop: ignore,
      onSend: ignore,
      onRecordAgain: ignore,
      onDiscard: ignore,
      onClose: close,
    },
    internals.overlayMode ?? 'closed',
  );
  overlay.render({
    state,
    link: null,
    title: '',
    microphone: false,
    maxDurationMs: 0,
    stopReason: null,
    recording: null,
    originRefused: false,
  });
  internals.onOverlay?.(overlay.root);
  const recorder: Recorder = {
    get state() {
      return state;
    },
    close,
  };
  active = { recorder };
  notify();
  return recorder;
}

/** `startRecorder`, with what the tests replace. */
export function startRecorderWith(
  token: string,
  options: RecorderOptions = {},
  internals: Partial<RecorderInternals> = {},
): Recorder | null {
  try {
    if (active !== undefined) return active.recorder;
    if (!isRecordingToken(token)) return null;
    const apiOrigin = options.apiOrigin ?? DEFAULT_API_ORIGIN;
    const intake = createIntake({
      apiOrigin,
      token,
      ...(internals.fetch === undefined ? {} : { fetch: internals.fetch }),
      ...(internals.timeoutMs === undefined
        ? {}
        : { timeoutMs: internals.timeoutMs, uploadTimeoutMs: internals.timeoutMs }),
    });
    if (!isRecordingSupported()) return openUnsupported(options, internals);
    const strings = stringsFor(options.locale);
    const blur = createBlurController();
    let timer: ReturnType<typeof setInterval> | undefined;
    let state: RecorderState = 'loading';

    const sanitizers: Sanitizers = {};
    if (options.logSanitizer !== undefined) sanitizers.logSanitizer = options.logSanitizer;
    if (options.requestSanitizer !== undefined)
      sanitizers.requestSanitizer = options.requestSanitizer;
    if (options.responseSanitizer !== undefined)
      sanitizers.responseSanitizer = options.responseSanitizer;
    if (options.webSocketSanitizer !== undefined)
      sanitizers.webSocketSanitizer = options.webSocketSanitizer;

    const onPageHide = (): void => {
      controller.pageHidden();
    };

    function teardown(): void {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      blur.stop();
      overlay.remove();
      window.removeEventListener('pagehide', onPageHide);
      if (active?.recorder === recorder) active = undefined;
    }

    const controller = createRecordingController({
      intake,
      query: linkQuery(options),
      crossOrigin: new URL(apiOrigin).origin !== location.origin,
      acquireMedia: internals.acquireMedia ?? acquireDisplay,
      createVideoRecorder,
      startCaptures(session) {
        applyAutoBlur(blur, document, options.blur ?? []);
        const captures = startPageCaptures(session, {
          ...sanitizers,
          ignoreUrls: [intake.prefix, ...(options.ignoreUrls ?? [])],
          blur,
          ignore: (element) => element === overlay.host,
        });
        return {
          stop() {
            captures.stop();
            blur.stop();
          },
        };
      },
      collectEnvironment: () => collectEnvironment(),
      collectMetadata,
      gzip: gzipNdjson,
      epoch: () => Date.now(),
      monotonic: () => performance.now(),
      onChange(snapshot) {
        state = snapshot.state;
        overlay.render(snapshot);
        const timed = state === 'recording' || state === 'paused';
        if (timed && timer === undefined) {
          timer = setInterval(() => {
            overlay.tick(controller.elapsedMs(), snapshot.maxDurationMs);
          }, 250);
        } else if (!timed && timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
        if (state === 'closed') teardown();
        try {
          options.onStateChange?.(state);
        } catch {
          // A listener never breaks the recorder.
        }
      },
    });

    const overlay: Overlay = createOverlay(
      document,
      strings,
      {
        onMicrophone: (on) => {
          controller.setMicrophone(on);
        },
        onRecord: () => void controller.record(),
        onPause: () => {
          controller.pause();
        },
        onResume: () => {
          controller.resume();
        },
        onStop: () => void controller.stop(),
        onSend: () => void controller.send(),
        onRecordAgain: () => void controller.recordAgain(),
        onDiscard: () => void controller.discard(),
        onClose: () => {
          controller.close();
        },
      },
      internals.overlayMode ?? 'closed',
    );
    internals.onOverlay?.(overlay.root);
    window.addEventListener('pagehide', onPageHide);

    const recorder: Recorder = {
      get state() {
        return state;
      },
      close() {
        try {
          controller.close();
        } catch {
          teardown();
        }
      },
    };
    active = { recorder };
    void controller.load();
    return recorder;
  } catch {
    return null;
  }
}

/** `startRecorderFromUrl`, with what the tests replace. */
export function startRecorderFromUrlWith(
  options: RecorderOptions = {},
  internals: Partial<RecorderInternals> = {},
): Recorder | null {
  const token = takeRecordingToken();
  return token === null ? null : startRecorderWith(token, options, internals);
}

/**
 * Opens the recorder for a recording link token: an overlay on the page lets the visitor record
 * this tab and send it. Where the browser cannot record the screen (a phone, for one), the overlay
 * says so, in the `unsupported` state, and nothing is sent. Returns the open recorder (the same
 * one when called again), or `null` when the token is malformed or the API origin is not
 * http(s). Never throws.
 */
export function startRecorder(token: string, options: RecorderOptions = {}): Recorder | null {
  return startRecorderWith(token, options);
}

/**
 * Reads a recording link token from the page's address (`?probara-recording=<token>`), takes it
 * out of the address bar, and opens the recorder for it. `null` when the address carries none,
 * or as `startRecorder`. Never throws.
 */
export function startRecorderFromUrl(options: RecorderOptions = {}): Recorder | null {
  return startRecorderFromUrlWith(options);
}
