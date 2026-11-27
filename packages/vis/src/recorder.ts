/**
 * The in-page recorder: when a page is opened with a recording link token, an overlay lets the
 * visitor record the current tab, and the video, the console, network and user events and the
 * environment go to the recording link's intake as a Vis. Everything here runs in the browser;
 * the decisions are in the controller, which the tests drive with fakes.
 */
import {
  attachSharedCapture,
  collectEnvironment,
  createBlurController,
  createVideoRecorder,
  displayCaptureConstraints,
  gzipNdjson,
  pickVideoFormat,
  type CaptureRecord,
  type RecordingSession,
  type Sanitizers,
  type UrlPattern,
} from '@probara/vis-capture';
import { applyAutoBlur } from './blur.js';
import {
  createRecordingController,
  type ControllerDeps,
  type MediaCapture,
  type RecorderState,
} from './controller.js';
import { stringsFor, type Locale } from './i18n.js';
import { createIntake, type IntakeFetch, type LinkQuery } from './intake.js';
import { collectMetadata } from './metadata.js';
import { createOverlay, type Overlay } from './overlay.js';
import { isRecordingToken, takeRecordingToken } from './url.js';

/** The Probara API the recorder sends to unless `apiOrigin` names another. */
export const DEFAULT_API_ORIGIN = 'https://app.probara.net';

/** The most organizations a page may name. */
const MAX_ORGANIZATIONS = 20;

/** A ULID as Probara writes it: 26 Crockford base32 characters. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const MISSING_ORGANIZATIONS =
  'Probara Vis: the recorder did not start. Name the Probara organizations this page serves in the ' +
  '"organizations" option (data-organizations on the script tag): 1 to 20 organization IDs, ' +
  'shown in Probara under Vis settings, next to the recording domains.';

export interface RecorderOptions extends Sanitizers {
  /**
   * The ULIDs of the Probara organizations this page serves, 1 to 20 (Probara shows its ID in the
   * Vis settings, next to the recording domains). Required: without it the recorder does not
   * start. The intake serves the page only for a link of one of them, and only when the page is
   * on a recording domain of that organization (or on localhost for development).
   */
  organizations: readonly string[];
  /**
   * The origin of the Probara API that serves the recording link: `https://app.probara.net`
   * unless given; anything after the origin is ignored. The intake answers pages on the
   * recording domains of the organization (and on localhost for development).
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
export async function acquireDisplay(options: { microphone: boolean }): Promise<MediaCapture> {
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

export function linkQuery(options: Partial<RecorderOptions>): LinkQuery {
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
    refusal: null,
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

/** Logs one console warning; a console that throws never breaks the page. */
export function warn(message: string): void {
  try {
    console.warn(message);
  } catch {
    // A console that throws never breaks the page.
  }
}

/**
 * The organizations of `options`, trimmed, in capitals and each once, or `null` (with one console
 * warning, `warning` unless given) when they are missing, more than 20, or one is not a ULID.
 */
export function organizationsOf(
  options: { organizations?: unknown } | undefined,
  warning = MISSING_ORGANIZATIONS,
): string[] | null {
  const organizations = validOrganizations(options);
  if (organizations === null) warn(warning);
  return organizations;
}

/** `organizationsOf`, without the warning. */
export function validOrganizations(
  options: { organizations?: unknown } | undefined,
): string[] | null {
  const given: unknown = options?.organizations;
  const organizations = Array.isArray(given)
    ? [
        ...new Set(
          given.map((organization: unknown) =>
            typeof organization === 'string' ? organization.trim().toUpperCase() : '',
          ),
        ),
      ]
    : [];
  if (
    organizations.length === 0 ||
    organizations.length > MAX_ORGANIZATIONS ||
    !organizations.every((organization) => ULID.test(organization))
  ) {
    return null;
  }
  return organizations;
}

/** The site's sanitizers among `options`. */
export function sanitizersOf(options: Sanitizers): Sanitizers {
  const sanitizers: Sanitizers = {};
  if (options.logSanitizer !== undefined) sanitizers.logSanitizer = options.logSanitizer;
  if (options.requestSanitizer !== undefined)
    sanitizers.requestSanitizer = options.requestSanitizer;
  if (options.responseSanitizer !== undefined)
    sanitizers.responseSanitizer = options.responseSanitizer;
  if (options.webSocketSanitizer !== undefined)
    sanitizers.webSocketSanitizer = options.webSocketSanitizer;
  return sanitizers;
}

/**
 * Records what the page's shared capture hands over into a recording `session`, its time moved to
 * the recording's clock; what happened before the recording started is left out.
 */
function recordInto(session: RecordingSession, record: CaptureRecord): void {
  const now = session.stamp();
  const t = Math.round(now.t - (now.ts - record.entry.ts));
  if (t < 0) return;
  session.record(record.stream, { ...record.entry, t });
}

/**
 * What a recording controller needs from the page, but its intake and `onChange`: the shared
 * screen, the video, the captures (blurred as the page asks, the intake's requests and `ignore`d
 * elements left out), the environment and metadata.
 */
export function pageRecordingDeps(input: {
  intake: { prefix: string };
  options: Pick<RecorderOptions, 'blur' | 'ignoreUrls'> & Sanitizers;
  apiOrigin: string;
  acquireMedia?: RecorderInternals['acquireMedia'] | undefined;
  ignore: (element: Element) => boolean;
}): Omit<ControllerDeps, 'intake' | 'query' | 'onChange'> & { stopBlur: () => void } {
  const { options, intake } = input;
  const blur = createBlurController();
  const sanitizers = sanitizersOf(options);
  return {
    crossOrigin: new URL(input.apiOrigin).origin !== location.origin,
    acquireMedia: input.acquireMedia ?? acquireDisplay,
    createVideoRecorder,
    startCaptures(session) {
      applyAutoBlur(blur, document, options.blur ?? []);
      // The page's one capture, shared with the other Probara SDKs: never a second patch.
      const capture = attachSharedCapture({
        ...sanitizers,
        ignoreUrls: [intake.prefix, ...(options.ignoreUrls ?? [])],
        ignore: input.ignore,
        blur: options.blur ?? [],
      });
      const unsubscribe = capture.subscribe((record) => {
        recordInto(session, record);
      });
      return {
        stop() {
          unsubscribe();
          capture.release();
          blur.stop();
        },
      };
    },
    collectEnvironment: () => collectEnvironment(),
    collectMetadata,
    gzip: gzipNdjson,
    epoch: () => Date.now(),
    monotonic: () => performance.now(),
    stopBlur: () => {
      blur.stop();
    },
  };
}

/** `startRecorder`, with what the tests replace. */
export function startRecorderWith(
  token: string,
  options: RecorderOptions,
  internals: Partial<RecorderInternals> = {},
): Recorder | null {
  try {
    if (active !== undefined) return active.recorder;
    const organizations = organizationsOf(options);
    if (organizations === null) return null;
    return open(token, organizations, options, internals);
  } catch {
    return null;
  }
}

function open(
  token: string,
  organizations: readonly string[],
  options: RecorderOptions,
  internals: Partial<RecorderInternals>,
): Recorder | null {
  try {
    if (!isRecordingToken(token)) return null;
    const apiOrigin = options.apiOrigin ?? DEFAULT_API_ORIGIN;
    const intake = createIntake({
      apiOrigin,
      token,
      organizations,
      ...(internals.fetch === undefined ? {} : { fetch: internals.fetch }),
      ...(internals.timeoutMs === undefined
        ? {}
        : { timeoutMs: internals.timeoutMs, uploadTimeoutMs: internals.timeoutMs }),
    });
    if (!isRecordingSupported()) return openUnsupported(options, internals);
    const strings = stringsFor(options.locale);
    let timer: ReturnType<typeof setInterval> | undefined;
    let state: RecorderState = 'loading';
    const page = pageRecordingDeps({
      intake,
      options,
      apiOrigin,
      acquireMedia: internals.acquireMedia,
      ignore: (element) => element === overlay.host,
    });

    const onPageHide = (): void => {
      controller.pageHidden();
    };

    function teardown(): void {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      page.stopBlur();
      overlay.remove();
      window.removeEventListener('pagehide', onPageHide);
      if (active?.recorder === recorder) active = undefined;
    }

    const controller = createRecordingController({
      ...page,
      intake,
      query: linkQuery(options),
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
  options: RecorderOptions,
  internals: Partial<RecorderInternals> = {},
): Recorder | null {
  try {
    // Checked before the token is taken, so a page that names no organization leaves it in place.
    const organizations = organizationsOf(options);
    if (organizations === null) return null;
    const token = takeRecordingToken();
    if (token === null) return null;
    if (active !== undefined) return active.recorder;
    return open(token, organizations, options, internals);
  } catch {
    return null;
  }
}

/**
 * Opens the recorder for a recording link token: an overlay on the page lets the visitor record
 * this tab and send it. Where the browser cannot record the screen (a phone, for one), the overlay
 * says so, in the `unsupported` state, and nothing is sent. Returns the open recorder (the same
 * one when called again), or `null` when `organizations` is missing, holds more than 20 or a
 * value that is not a ULID (with one console warning), when the token is malformed, or when the
 * API origin is not http(s). Never throws.
 */
export function startRecorder(token: string, options: RecorderOptions): Recorder | null {
  return startRecorderWith(token, options);
}

/**
 * Reads a recording link token from the page's address (`?probara-recording=<token>`), takes it
 * out of the address bar, and opens the recorder for it. `null` when the address carries none,
 * or as `startRecorder`; without valid `organizations` it warns once and leaves the token in the
 * address. Never throws.
 */
export function startRecorderFromUrl(options: RecorderOptions): Recorder | null {
  return startRecorderFromUrlWith(options);
}
