/**
 * In-app reporting: the reporter a customer installs once in their own app, with a widget key, so
 * its users report a bug from whatever page they are on. The panel offers **Send what just
 * happened** (the instant replay: a rolling DOM replay and the console, network and user events
 * of the last minutes, buffered in memory from an idle moment after the page loads and sent only
 * when the reporter sends them) and **Record from the start** (the screen recording of a
 * recording link, through the widget's intake). Opened from the page's own button (`open()`) or
 * from an optional floating launcher.
 */
import { collectEnvironment, gzipNdjson, type VisMetadata } from '@probara/vis-capture';
import {
  isInstantReplaySupported,
  startPreClickBuffers,
  type Frozen,
  type PreClickBuffers,
} from './buffers.js';
import { createRecordingController, type RecordingController } from './controller.js';
import { stringsFor } from './i18n.js';
import {
  IntakeError,
  createWidgetIntake,
  widgetRefusalOf,
  type Intake,
  type LinkQuery,
  type ReporterTokenProvider,
  type Submission,
  type WidgetConfig,
  type WidgetIntake,
  type WidgetSubmissionStart,
} from './intake.js';
import { createLauncher, type Launcher, type LauncherPosition } from './launcher.js';
import { collectMetadata } from './metadata.js';
import {
  MAX_DESCRIPTION_LENGTH,
  createOverlay,
  type Overlay,
  type PanelSnapshot,
  type PanelState,
  type ReplaySummary,
} from './overlay.js';
import { createPartUploader } from './parts.js';
import {
  DEFAULT_API_ORIGIN,
  isRecordingSupported,
  linkQuery,
  organizationsOf,
  pageRecordingDeps,
  warn,
  type RecorderInternals,
  type RecorderOptions,
} from './recorder.js';
import { loadReplayModule, type ReplayModule } from './replay-loader.js';

/**
 * The reporter's state: `idle` while its panel is closed, `choosing` and `replay-review` for the
 * instant replay, the states of a recording otherwise, and `closed` once destroyed.
 */
export type ReporterState = PanelState;

/** What `open` goes to: the instant replay's review, or a recording from the start. */
export type ReporterMode = 'instant-replay' | 'record';

/**
 * The overrides a report sends: the widget key sets the folder in Probara and the intake refuses one
 * from the page, so a `folder` reaching here from plain JavaScript is dropped.
 */
function widgetQuery(options: ReporterOptions): LinkQuery {
  const query = linkQuery(options);
  delete query.folder;
  return query;
}

export interface ReporterOptions extends Omit<RecorderOptions, 'onStateChange' | 'folder'> {
  /** The widget key (`pvk_...`), shown in Probara under Vis → Settings → In-app reporting. */
  widgetKey: string;
  /**
   * Gives the token of the signed-in reporter, signed by your backend (`signReporterToken`), or
   * `null` for none. Called once per report, right before it starts.
   */
  reporterToken?: ReporterTokenProvider;
  /** A floating button that opens the panel: off unless given. */
  launcher?: boolean | { position?: LauncherPosition; label?: string };
  onStateChange?: (state: ReporterState) => void;
}

export interface Reporter {
  readonly state: ReporterState;
  /**
   * Opens the panel: without a mode it offers both; `instant-replay` goes to the review of what
   * just happened (or offers recording when there is none); `record` to a recording. Does
   * nothing while the panel is open or once destroyed.
   */
  open(mode?: ReporterMode): void;
  /** Closes the panel; a report in progress is discarded and its submission aborted. */
  close(): void;
  /** Closes the panel, stops every capture and removes the launcher. */
  destroy(): void;
}

/** What the tests replace; not part of the published API. */
export interface ReporterInternals extends RecorderInternals {
  loadReplay: () => Promise<ReplayModule>;
  /** Where the widget's configuration is kept between pages: `sessionStorage` unless given. */
  storage: Storage | null;
  /** Runs `run` once the page is idle; returns the cancel function. */
  whenIdle: (run: () => void) => () => void;
  recordingSupported: () => boolean;
  onLauncher: (root: ShadowRoot) => void;
}

/** A widget key: `pvk_`, a payload and a signature, both base64url. */
const WIDGET_KEY = /^pvk_[\w-]+\.[\w-]+$/;

/** How long the widget's configuration is kept in `sessionStorage`. */
export const WIDGET_CONFIG_CACHE_MS = 5 * 60_000;
const CONFIG_STORAGE_PREFIX = 'probara-vis-widget:';

/** The longest an idle callback waits before the instant replay starts anyway. */
const IDLE_TIMEOUT_MS = 5000;
/** Where `requestIdleCallback` is missing, the instant replay starts this long after creation. */
const IDLE_FALLBACK_MS = 2000;

const MAX_TITLE_LENGTH = 200;

const INVALID_OPTIONS =
  'Probara Vis: the reporter did not start. Give it the widget key ("widgetKey", data-widget-key ' +
  'on the script tag), shown in Probara under Vis settings, and the Probara organizations this ' +
  'page serves ("organizations", data-organizations): 1 to 20 organization IDs.';

/** The one reporter of the page, until it is destroyed. */
let active: Reporter | undefined;

function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => {
      cancelIdleCallback(id);
    };
  }
  const timer = setTimeout(run, IDLE_FALLBACK_MS);
  return () => {
    clearTimeout(timer);
  };
}

function defaultStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isConfig(value: unknown): value is WidgetConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Record<string, unknown>;
  return (
    typeof config['organizationName'] === 'string' &&
    typeof config['recordingMaxMinutes'] === 'number' &&
    typeof config['instantReplay'] === 'boolean' &&
    typeof config['requireVerifiedReporter'] === 'boolean'
  );
}

/** The configuration kept for `key`, when it is younger than five minutes. */
function storedConfig(storage: Storage | null, key: string): WidgetConfig | null {
  try {
    const raw = storage?.getItem(CONFIG_STORAGE_PREFIX + key);
    if (raw === null || raw === undefined) return null;
    const stored = JSON.parse(raw) as { at?: unknown; config?: unknown };
    const age = Date.now() - (typeof stored.at === 'number' ? stored.at : Number.NaN);
    return age >= 0 && age < WIDGET_CONFIG_CACHE_MS && isConfig(stored.config)
      ? stored.config
      : null;
  } catch {
    return null;
  }
}

function storeConfig(storage: Storage | null, key: string, config: WidgetConfig): void {
  try {
    storage?.setItem(CONFIG_STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), config }));
  } catch {
    // A full or refused storage only means the configuration is read again.
  }
}

/** What the review of `frozen` shows. */
function summarize(frozen: Frozen): ReplaySummary {
  const starts = [
    frozen.events[0]?.timestamp,
    frozen.console[0]?.ts,
    frozen.network[0]?.ts,
    frozen.userEvents[0]?.ts,
  ].filter((value): value is number => typeof value === 'number');
  const first = Math.min(frozen.at, ...starts);
  return {
    durationMs: Math.max(1, Math.round(frozen.at - first)),
    page: `${location.host}${location.pathname}`,
  };
}

/** The state a failed report ends in, and the widget's reason when it gave one. */
function failure(error: unknown): Pick<PanelSnapshot, 'state' | 'refusal'> {
  const refusal = widgetRefusalOf(error);
  if (refusal === 'reporter_required' || refusal === 'invalid_reporter')
    return { state: 'unavailable', refusal };
  if (error instanceof IntakeError) {
    if (error.status === 429) return { state: 'busy', refusal };
    if (error.status === 404 || error.status === 422) return { state: 'unavailable', refusal };
  }
  return { state: 'failed', refusal: null };
}

/** `createReporter`, with what the tests replace. */
export function createReporterWith(
  options: ReporterOptions,
  internals: Partial<ReporterInternals> = {},
): Reporter | null {
  try {
    if (active !== undefined) return active;
    const given = options as Partial<ReporterOptions> | undefined;
    const widgetKey = given?.widgetKey;
    if (typeof widgetKey !== 'string' || !WIDGET_KEY.test(widgetKey)) {
      warn(INVALID_OPTIONS);
      return null;
    }
    const organizations = organizationsOf(given, INVALID_OPTIONS);
    if (organizations === null) return null;
    const apiOrigin = options.apiOrigin ?? DEFAULT_API_ORIGIN;
    let intake: WidgetIntake;
    try {
      intake = createWidgetIntake({
        apiOrigin,
        widgetKey,
        organizations,
        ...(options.reporterToken === undefined ? {} : { reporterToken: options.reporterToken }),
        ...(internals.fetch === undefined ? {} : { fetch: internals.fetch }),
        ...(internals.timeoutMs === undefined
          ? {}
          : { timeoutMs: internals.timeoutMs, uploadTimeoutMs: internals.timeoutMs }),
      });
    } catch {
      warn(INVALID_OPTIONS);
      return null;
    }
    const reporter = build(widgetKey, intake, apiOrigin, options, internals);
    active = reporter;
    return reporter;
  } catch {
    return null;
  }
}

function build(
  widgetKey: string,
  intake: WidgetIntake,
  apiOrigin: string,
  options: ReporterOptions,
  internals: Partial<ReporterInternals>,
): Reporter {
  const strings = stringsFor(options.locale);
  const storage = internals.storage === undefined ? defaultStorage() : internals.storage;
  const recordingSupported = internals.recordingSupported ?? isRecordingSupported;
  const loadReplay = internals.loadReplay ?? loadReplayModule;
  const mode = internals.overlayMode ?? 'closed';

  let state: ReporterState = 'idle';
  let destroyed = false;
  let config: WidgetConfig | null = storedConfig(storage, widgetKey);
  let configLoad: Promise<WidgetConfig> | undefined;
  let replayModule: ReplayModule | undefined;
  let buffers: PreClickBuffers | undefined;
  /** The buffers were stopped for a recording, and start over when its panel closes. */
  let buffersPaused = false;
  /**
   * The panel took an instant replay: the buffers start over when it finishes (sent or
   * discarded), and buffer on when its review is only closed.
   */
  let replayTaken = false;
  let cancelIdle: (() => void) | undefined;
  let overlay: Overlay | undefined;
  let controller: RecordingController | undefined;
  let stopRecordingBlur: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** The instant replay reviewed, with the metadata of the moment it was taken. */
  let taken: { frozen: Frozen; summary: ReplaySummary; metadata: VisMetadata | null } | undefined;
  /** The instant replay being sent: cancelled when the panel closes meanwhile. */
  let sending: { cancelled: boolean; submission?: Submission } | undefined;

  const base: PanelSnapshot = {
    state: 'idle',
    link: null,
    title: '',
    microphone: false,
    maxDurationMs: 0,
    stopReason: null,
    recording: null,
    originRefused: false,
    refusal: null,
    widget: true,
  };

  const ignore = (element: Element): boolean =>
    element === overlay?.host || element === launcher?.host;

  function notify(): void {
    try {
      options.onStateChange?.(state);
    } catch {
      // A listener never breaks the reporter.
    }
  }

  function setState(next: ReporterState): void {
    if (state === next) return;
    state = next;
    updateLauncher();
    notify();
  }

  function show(snapshot: PanelSnapshot): void {
    overlay?.render(snapshot);
    setState(snapshot.state);
  }

  function updateLauncher(): void {
    launcher?.show(
      !destroyed && state === 'idle' && (recordingSupported() || buffers?.available === true),
    );
  }

  function readConfig(): Promise<WidgetConfig> {
    const stored = storedConfig(storage, widgetKey);
    if (stored !== null) return Promise.resolve(stored);
    configLoad ??= intake
      .readConfig()
      .then((read) => {
        config = read;
        storeConfig(storage, widgetKey, read);
        return read;
      })
      .finally(() => {
        configLoad = undefined;
      });
    return configLoad;
  }

  /** Starts the instant replay when the widget keeps one and the panel is closed. */
  function startBuffers(): void {
    if (destroyed || replayModule === undefined || buffers !== undefined || state !== 'idle')
      return;
    buffers = startPreClickBuffers({
      ...options,
      replay: replayModule,
      blur: options.blur ?? [],
      ignoreUrls: [intake.prefix, ...(options.ignoreUrls ?? [])],
      ignore,
    });
    updateLauncher();
  }

  /** Stops buffering while the panel records: the recording wraps the page itself. */
  function pauseBuffers(): void {
    if (buffers === undefined || buffersPaused) return;
    buffersPaused = true;
    buffers.freeze();
  }

  function resumeBuffers(): void {
    if (buffers !== undefined && (buffersPaused || replayTaken)) buffers.restart();
    buffersPaused = false;
    replayTaken = false;
    startBuffers();
  }

  function scheduleBuffers(): void {
    if (!isInstantReplaySupported()) return;
    cancelIdle = (internals.whenIdle ?? whenIdle)(() => {
      cancelIdle = undefined;
      loadReplay()
        .then((module) => {
          replayModule = module;
          startBuffers();
        })
        .catch(() => {
          // No instant replay: recording is still offered.
        });
    });
  }

  function openPanel(): void {
    overlay = createOverlay(
      document,
      strings,
      {
        onChooseReplay: chooseReplay,
        onChooseRecord: startRecording,
        onMicrophone: (on) => {
          controller?.setMicrophone(on);
        },
        onRecord: () => void controller?.record(),
        onPause: () => {
          controller?.pause();
        },
        onResume: () => {
          controller?.resume();
        },
        onStop: () => void controller?.stop(),
        onSend: (description) => {
          if (controller !== undefined) void controller.send();
          else void sendReplay(description ?? '');
        },
        onRecordAgain: () => void controller?.recordAgain(),
        onDiscard: () => {
          if (controller !== undefined) void controller.discard();
          else closePanel();
        },
        onClose: () => {
          // Closing the review loses nothing: the buffers never stopped, and the next open shows
          // what happened up to then.
          if (state === 'replay-review') replayTaken = false;
          closePanel();
        },
      },
      mode,
    );
    internals.onOverlay?.(overlay.root);
  }

  /** The panel is gone: the reporter is idle again and buffers what happens next. */
  function finishPanel(resumeLater = false): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    stopRecordingBlur?.();
    stopRecordingBlur = undefined;
    controller = undefined;
    taken = undefined;
    overlay?.remove();
    overlay = undefined;
    if (destroyed) return;
    setState('idle');
    if (resumeLater) {
      queueMicrotask(() => {
        if (destroyed || state !== 'idle') return;
        resumeBuffers();
        updateLauncher();
      });
      return;
    }
    resumeBuffers();
    updateLauncher();
  }

  function closePanel(): void {
    if (controller !== undefined) {
      // Its `closed` state finishes the panel.
      controller.close();
      return;
    }
    const current = sending;
    sending = undefined;
    if (current !== undefined) {
      current.cancelled = true;
      void current.submission?.abort().catch(() => undefined);
    }
    finishPanel();
  }

  function chooseReplay(): void {
    if (overlay === undefined || controller !== undefined) return;
    const frozen = buffers?.snapshot() ?? null;
    if (frozen === null) {
      show({
        ...base,
        state: 'choosing',
        choices: { replay: false, record: recordingSupported() },
      });
      return;
    }
    let metadata: VisMetadata | null;
    try {
      metadata = collectMetadata();
    } catch {
      metadata = null;
    }
    replayTaken = true;
    taken = { frozen, summary: summarize(frozen), metadata };
    show({ ...base, state: 'replay-review', replay: taken.summary });
  }

  async function sendReplay(description: string): Promise<void> {
    const current = taken;
    if (current === undefined || state !== 'replay-review') return;
    const attempt: { cancelled: boolean; submission?: Submission } = { cancelled: false };
    sending = attempt;
    // Read through a function: closing the panel changes it while this awaits.
    const cancelled = (): boolean => attempt.cancelled;
    const replay = current.summary;
    show({ ...base, state: 'sending', replay });
    try {
      const read = await readConfig().catch(() => null);
      const captured = await collectEnvironment();
      const body: WidgetSubmissionStart = { kind: 'replay' };
      const text = description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
      if (text !== '') body.description = text;
      const title = (options.title ?? '').trim().slice(0, MAX_TITLE_LENGTH);
      if (title !== '') body.title = title;
      if (options.reference !== undefined) body.reference = options.reference;
      if (captured.pageUrl !== undefined) body.pageUrl = captured.pageUrl;
      if (captured.pageTitle !== undefined) body.pageTitle = captured.pageTitle;
      body.environment = captured.environment;
      body.capturedAt = current.frozen.at;
      if (current.metadata !== null) body.metadata = current.metadata;
      if (cancelled()) return;
      const submission = await intake.start(body);
      attempt.submission = submission;
      if (cancelled()) {
        await submission.abort().catch(() => undefined);
        return;
      }
      const gzipped = await gzipNdjson(current.frozen.events);
      const upload = await submission.createUpload('application/x-ndjson', 'replay');
      const uploader = createPartUploader({
        partSize: upload.partSize,
        maxBytes: upload.maxBytes,
        upload: (partNumber, part) => submission.putPart(upload.uploadUlid, partNumber, part),
      });
      uploader.add(new Blob([gzipped]));
      await uploader.finish();
      if (cancelled()) return;
      await submission.complete(upload.uploadUlid);
      const streams = [
        ['console', current.frozen.console],
        ['network', current.frozen.network],
        ['events', current.frozen.userEvents],
      ] as const;
      for (const [stream, entries] of streams) {
        if (entries.length === 0) continue;
        if (cancelled()) return;
        await submission.putAsset(stream, await gzipNdjson(entries));
      }
      if (cancelled()) return;
      // The intake refuses a length past the plan's longest recording.
      const maxMs = (read?.recordingMaxMinutes ?? 0) * 60_000;
      await submission.finalize(maxMs > 0 ? Math.min(replay.durationMs, maxMs) : replay.durationMs);
      sending = undefined;
      taken = undefined;
      show({ ...base, state: 'done', replay });
    } catch (error) {
      if (cancelled()) return;
      sending = undefined;
      taken = undefined;
      void attempt.submission?.abort().catch(() => undefined);
      show({ ...base, ...failure(error), replay });
    }
  }

  function startRecording(): void {
    if (overlay === undefined || controller !== undefined) return;
    pauseBuffers();
    if (!recordingSupported()) {
      show({ ...base, state: 'unsupported' });
      return;
    }
    const page = pageRecordingDeps({
      intake,
      options,
      apiOrigin,
      acquireMedia: internals.acquireMedia,
      ignore,
    });
    stopRecordingBlur = page.stopBlur;
    // The widget's intake as a recording link's: its configuration is the link.
    const widgetAsLink: Intake = {
      prefix: intake.prefix,
      async readLink() {
        const read = await readConfig();
        return {
          organizationName: read.organizationName,
          title: options.title ?? '',
          reference: options.reference ?? null,
          folder: null,
          microphone: options.microphone ?? false,
          recordingMaxMinutes: read.recordingMaxMinutes,
          expiresAt: null,
        };
      },
      start: (body) => intake.start({ ...body, kind: 'video' }),
    };
    const recording = createRecordingController({
      ...page,
      intake: widgetAsLink,
      query: widgetQuery(options),
      refusalOf: widgetRefusalOf,
      onChange(snapshot) {
        if (snapshot.state === 'closed') {
          // The controller stops its captures right after it says so: buffering starts again
          // once they are, so the page is never wrapped twice.
          finishPanel(true);
          return;
        }
        show({ ...snapshot, widget: true });
        const timed = snapshot.state === 'recording' || snapshot.state === 'paused';
        if (timed && timer === undefined) {
          timer = setInterval(() => {
            overlay?.tick(recording.elapsedMs(), snapshot.maxDurationMs);
          }, 250);
        } else if (!timed && timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
      },
    });
    controller = recording;
    void recording.load();
  }

  const onPageHide = (): void => {
    if (controller !== undefined) {
      controller.pageHidden();
      return;
    }
    const current = sending;
    sending = undefined;
    if (current !== undefined) {
      current.cancelled = true;
      void current.submission?.abort({ keepalive: true }).catch(() => undefined);
    }
  };

  const launcherOption = options.launcher;
  const launcher: Launcher | undefined =
    launcherOption === undefined || launcherOption === false
      ? undefined
      : createLauncher(
          document,
          {
            label:
              typeof launcherOption === 'object' &&
              typeof launcherOption.label === 'string' &&
              launcherOption.label.trim() !== ''
                ? launcherOption.label
                : strings.reportProblem,
            position:
              typeof launcherOption === 'object' && launcherOption.position === 'bottom-left'
                ? 'bottom-left'
                : 'bottom-right',
            onOpen: () => {
              reporter.open();
            },
          },
          mode,
        );
  if (launcher !== undefined) internals.onLauncher?.(launcher.root);

  const reporter: Reporter = {
    get state() {
      return state;
    },
    open(openMode) {
      try {
        if (destroyed || state !== 'idle') return;
        openPanel();
        if (openMode === 'record') {
          startRecording();
          return;
        }
        const replay = buffers?.available === true;
        const record = recordingSupported();
        if (openMode === 'instant-replay' && replay) {
          chooseReplay();
          return;
        }
        if (!replay && !record) show({ ...base, state: 'unsupported' });
        else show({ ...base, state: 'choosing', choices: { replay, record } });
      } catch {
        finishPanel();
      }
    },
    close() {
      try {
        if (destroyed || state === 'idle') return;
        // As the panel's Close: a review closed loses nothing, the buffers go on.
        if (state === 'replay-review') replayTaken = false;
        closePanel();
      } catch {
        finishPanel();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        cancelIdle?.();
        if (controller !== undefined) controller.close();
        closePanel();
      } catch {
        // Whatever is left is removed below.
      }
      buffers?.stop();
      buffers = undefined;
      overlay?.remove();
      launcher?.remove();
      window.removeEventListener('pagehide', onPageHide);
      if (active === reporter) active = undefined;
      state = 'closed';
      notify();
    },
  };

  window.addEventListener('pagehide', onPageHide);
  updateLauncher();
  if (config !== null) {
    if (config.instantReplay) scheduleBuffers();
  } else {
    readConfig()
      .then((read) => {
        if (!destroyed && read.instantReplay) scheduleBuffers();
        updateLauncher();
      })
      .catch(() => {
        // Read again when the panel needs it.
      });
  }
  return reporter;
}

/**
 * Starts in-app reporting on this page with a widget key: buffers an instant replay when the
 * widget keeps one, and shows the floating launcher when asked. Returns the `Reporter` (the same
 * one when called again, until it is destroyed), or `null` with one console warning when
 * `widgetKey` or `organizations` is not valid or `apiOrigin` is not an http(s) URL. Never
 * throws.
 */
export function createReporter(options: ReporterOptions): Reporter | null {
  return createReporterWith(options);
}
