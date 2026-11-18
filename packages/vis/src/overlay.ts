/**
 * The recorder's controls on the page: one host element holding a shadow root (closed unless a
 * test asks), so the page's styles and scripts cannot reach in and its own styles cannot leak
 * out. Built with DOM calls only (no `innerHTML`, no inline `<style>` when constructed
 * stylesheets exist), so a strict Content Security Policy or Trusted Types do not stop it.
 *
 * A ready card ("Ready to record?", Start recording and a quiet microphone toggle), the timer
 * and its controls while recording, and once stopped the recording itself to watch before
 * choosing Send, Record again or Discard; the last two ask first. A recording the player cannot
 * play (an `error` of the video element, such as a decode failure) is never offered for sending:
 * the panel says so and offers Record again and Discard only.
 */
import type { RecorderSnapshot, RecorderState } from './controller.js';
import type { Strings } from './i18n.js';
import type { Refusal } from './intake.js';

/**
 * The states of the panel: a recording's, and those of in-app reporting: `idle` (the panel is
 * closed), `choosing` (what to send) and `replay-review` (the instant replay before it is sent).
 */
export type PanelState = RecorderState | 'idle' | 'choosing' | 'replay-review';

/** What the review of an instant replay shows. */
export interface ReplaySummary {
  /** How much time it covers. */
  durationMs: number;
  /** The page, without its query or fragment. */
  page: string;
  consoleErrors: number;
  failedRequests: number;
}

export interface PanelSnapshot extends Omit<RecorderSnapshot, 'state' | 'refusal'> {
  state: PanelState;
  refusal?: Refusal | null;
  /** In-app reporting: its wording rather than a recording link's. */
  widget?: boolean;
  /** What `choosing` offers. */
  choices?: { replay: boolean; record: boolean };
  /** The instant replay reviewed, sent or failed: set from `replay-review` on. */
  replay?: ReplaySummary | null;
}

/** The longest description of what happened. */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** The attribute of the overlay's host element. */
export const OVERLAY_ATTRIBUTE = 'data-probara-vis-recorder';

/** Where the brand link under the panel goes. */
const BRAND_URL = 'https://probara.net';

export interface OverlayHandlers {
  onMicrophone(on: boolean): void;
  onRecord(): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  /** Sends the recording, or the instant replay with what happened (trimmed). */
  onSend(description?: string): void;
  /** In-app reporting: the visitor chose to send the instant replay. */
  onChooseReplay?(): void;
  /** In-app reporting: the visitor chose to record from the start. */
  onChooseRecord?(): void;
  /** Confirmed: the watched recording is thrown away and a new one starts. */
  onRecordAgain(): void;
  /** While recording at once; while the recording is watched, once confirmed. */
  onDiscard(): void;
  onClose(): void;
}

export interface Overlay {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  render(snapshot: PanelSnapshot): void;
  /** Shows the recorded time against the limit. */
  tick(elapsedMs: number, maxMs: number): void;
  remove(): void;
}

const CSS = `
:host { all: initial; }
.panel { box-sizing: border-box; width: 300px; padding: 16px; border-radius: 12px;
  background: #ffffff; color: #1b1d21; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.panel.wide { width: 380px; }
.heading { margin: 0 0 12px; font-size: 16px; font-weight: 600; text-align: center; }
.message { margin: 0 0 10px; }
.start { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 0 0 8px; }
.start button.primary { width: 100%; justify-content: center; }
.player { display: block; box-sizing: border-box; width: 100%; max-height: 240px; margin: 0 0 12px;
  border-radius: 8px; background: #000; }
.timer { margin: 0 0 10px; font-variant-numeric: tabular-nums; font-size: 20px; font-weight: 600; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.confirm { margin: 0; }
.confirm-title { margin: 0 0 4px; font-weight: 600; }
.confirm-body { margin: 0 0 12px; color: #5b616b; }
button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  border: 1px solid #c4c8cf; border-radius: 6px; background: #fff; color: inherit; font: inherit;
  cursor: pointer; }
button.primary { border-color: #3a5bd9; background: #3a5bd9; color: #fff; }
button.danger { border-color: #c4332b; background: #c4332b; color: #fff; }
button.quiet { border-color: transparent; background: transparent; color: #5b616b;
  font-size: 13px; padding: 4px 8px; }
button:focus-visible, a:focus-visible { outline: 2px solid #3a5bd9; outline-offset: 2px; }
.brand { display: block; margin: 6px 0 0; text-align: center; color: #5b616b; font: 12px/1.4
  system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-decoration: none; }
.brand:hover { text-decoration: underline; }
.choices { display: flex; flex-direction: column; gap: 8px; margin: 0 0 8px; }
.choices button { justify-content: center; }
.summary { margin: 0 0 10px; color: #5b616b; }
.summary p { margin: 0 0 2px; }
.describe { display: flex; flex-direction: column; gap: 4px; margin: 0 0 12px; }
.describe label { font-weight: 600; }
.describe textarea { box-sizing: border-box; width: 100%; min-height: 72px; padding: 6px 8px;
  border: 1px solid #c4c8cf; border-radius: 6px; font: inherit; color: inherit; resize: vertical; }
.describe textarea:focus-visible { outline: 2px solid #3a5bd9; outline-offset: 1px; }
.hint { margin: 0; color: #5b616b; font-size: 12px; }
[hidden] { display: none !important; }
`;

const VISIBLE: Readonly<Record<string, readonly PanelState[]>> = {
  heading: ['ready', 'review', 'choosing', 'replay-review'],
  start: ['ready'],
  choices: ['choosing'],
  summary: ['replay-review'],
  describe: ['replay-review'],
  player: ['review'],
  timer: ['recording', 'paused'],
  message: [
    'loading',
    'unavailable',
    'busy',
    'starting',
    'paused',
    'review',
    'sending',
    'done',
    'failed',
    'unsupported',
  ],
  pause: ['recording'],
  resume: ['paused'],
  stop: ['recording', 'paused'],
  send: ['review', 'replay-review'],
  recordAgain: ['review'],
  discard: ['recording', 'paused', 'review', 'replay-review'],
  close: ['loading', 'unavailable', 'busy', 'ready', 'done', 'failed', 'unsupported', 'choosing'],
};

/** The states that review something before it is sent, and ask before discarding it. */
const REVIEWS: readonly PanelState[] = ['review', 'replay-review'];

const SVG = 'http://www.w3.org/2000/svg';

function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function createOverlay(
  doc: Document,
  strings: Strings,
  handlers: OverlayHandlers,
  mode: ShadowRootMode = 'closed',
): Overlay {
  const host = doc.createElement('div');
  host.setAttribute(OVERLAY_ATTRIBUTE, '');
  // Inline style through the CSSOM, which a Content Security Policy does not block.
  for (const [name, value] of [
    ['position', 'fixed'],
    ['right', '16px'],
    ['bottom', '16px'],
    ['z-index', '2147483647'],
  ] as const) {
    host.style.setProperty(name, value, 'important');
  }
  const root = host.attachShadow({ mode });
  const view = doc.defaultView;
  if (view !== null && 'adoptedStyleSheets' in root) {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } else {
    const style = doc.createElement('style');
    style.textContent = CSS;
    root.append(style);
  }
  // Keys typed into the controls never reach the page's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress', 'input']) {
    root.addEventListener(type, (event) => {
      event.stopPropagation();
    });
  }

  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const created = doc.createElement(tag);
    if (className !== undefined) created.className = className;
    if (text !== undefined) created.textContent = text;
    return created;
  };

  /** A 16px stroke icon, hidden from assistive technology. */
  const icon = (draw: (svg: SVGSVGElement) => void): SVGSVGElement => {
    const svg = doc.createElementNS(SVG, 'svg');
    for (const [name, value] of [
      ['width', '16'],
      ['height', '16'],
      ['viewBox', '0 0 24 24'],
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '2'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['aria-hidden', 'true'],
      ['focusable', 'false'],
    ] as const) {
      svg.setAttribute(name, value);
    }
    draw(svg);
    return svg;
  };
  const camera = icon((svg) => {
    const lens = doc.createElementNS(SVG, 'path');
    lens.setAttribute('d', 'm16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5');
    const body = doc.createElementNS(SVG, 'rect');
    for (const [name, value] of [
      ['x', '2'],
      ['y', '6'],
      ['width', '14'],
      ['height', '12'],
      ['rx', '2'],
    ] as const) {
      body.setAttribute(name, value);
    }
    svg.append(lens, body);
  });

  const panel = element('div', 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', strings.recorder);
  const heading = element('p', 'heading');
  const message = element('p', 'message');
  message.setAttribute('role', 'status');
  const player = element('video', 'player');
  player.controls = true;
  player.playsInline = true;
  player.preload = 'metadata';
  player.setAttribute('aria-label', strings.player);
  const timer = element('p', 'timer');
  timer.setAttribute('aria-live', 'off');

  const button = (text: string, onClick: () => void, className?: string): HTMLButtonElement => {
    const created = element('button', className, text);
    created.type = 'button';
    created.addEventListener('click', onClick);
    return created;
  };

  let microphoneOn = false;
  const microphone = button(
    strings.unmuteMicrophone,
    () => {
      showMicrophone(!microphoneOn);
      handlers.onMicrophone(microphoneOn);
    },
    'quiet',
  );
  function showMicrophone(on: boolean): void {
    microphoneOn = on;
    microphone.textContent = on ? strings.muteMicrophone : strings.unmuteMicrophone;
    microphone.setAttribute('aria-pressed', String(on));
  }
  showMicrophone(false);

  const record = button(
    strings.record,
    () => {
      handlers.onRecord();
    },
    'primary',
  );
  record.prepend(camera);
  const start = element('div', 'start');
  start.append(record, microphone);

  /** What the open confirmation asks for, and the button that opened it. */
  let confirming: { intent: 'recordAgain' | 'discard'; opener: HTMLButtonElement } | null = null;
  let shown: PanelState | undefined;

  const replayChoice = button(
    strings.sendWhatHappened,
    () => {
      handlers.onChooseReplay?.();
    },
    'primary',
  );
  const recordChoice = button(strings.recordFromStart, () => {
    handlers.onChooseRecord?.();
  });
  const choices = element('div', 'choices');
  choices.append(replayChoice, recordChoice);

  const summary = element('div', 'summary');
  const summarySpan = element('p');
  const summaryPage = element('p');
  const summaryCounts = element('p');
  summary.append(summarySpan, summaryPage, summaryCounts);

  const describe = element('div', 'describe');
  const field = element('textarea');
  field.id = 'probara-vis-description';
  field.maxLength = MAX_DESCRIPTION_LENGTH;
  field.rows = 3;
  const fieldLabel = element('label', undefined, strings.whatHappened);
  fieldLabel.htmlFor = field.id;
  const hint = element('p', 'hint', strings.whatHappenedHint);
  hint.id = 'probara-vis-description-hint';
  field.setAttribute('aria-describedby', hint.id);
  describe.append(fieldLabel, field, hint);

  const buttons = {
    pause: button(strings.pause, () => {
      handlers.onPause();
    }),
    resume: button(strings.resume, () => {
      handlers.onResume();
    }),
    stop: button(
      strings.stop,
      () => {
        handlers.onStop();
      },
      'primary',
    ),
    send: button(
      strings.send,
      () => {
        if (shown === 'replay-review')
          handlers.onSend(field.value.trim().slice(0, MAX_DESCRIPTION_LENGTH));
        else handlers.onSend();
      },
      'primary',
    ),
    recordAgain: button(strings.recordAgain, () => {
      ask('recordAgain', buttons.recordAgain);
    }),
    discard: button(strings.discard, () => {
      // While recording it discards at once, as it always has; a watched recording asks first.
      if (shown !== undefined && REVIEWS.includes(shown)) ask('discard', buttons.discard);
      else handlers.onDiscard();
    }),
    close: button(strings.close, () => {
      handlers.onClose();
    }),
  };
  const actions = element('div', 'actions');
  actions.append(...Object.values(buttons));
  /** The watched recording could not be played: it is not offered for sending. */
  let unplayable = false;
  /** The choices a confirmation hides while it asks, and shows again when it backs out. */
  const reviewActions = (): HTMLElement[] =>
    shown === 'replay-review'
      ? [buttons.send, buttons.discard]
      : unplayable
        ? [buttons.recordAgain, buttons.discard]
        : [buttons.send, buttons.recordAgain, buttons.discard];

  const confirm = element('div', 'confirm');
  confirm.setAttribute('role', 'alertdialog');
  const confirmTitle = element('p', 'confirm-title');
  confirmTitle.id = 'probara-vis-confirm-title';
  const confirmBody = element('p', 'confirm-body');
  confirmBody.id = 'probara-vis-confirm-body';
  confirm.setAttribute('aria-labelledby', confirmTitle.id);
  confirm.setAttribute('aria-describedby', confirmBody.id);
  const cancel = button(strings.cancel, () => {
    closeConfirm(true);
  });
  const confirmed = button(
    '',
    () => {
      const intent = confirming?.intent;
      closeConfirm(false);
      if (intent === 'recordAgain') handlers.onRecordAgain();
      else if (intent === 'discard') handlers.onDiscard();
    },
    'danger',
  );
  const confirmActions = element('div', 'actions');
  confirmActions.append(cancel, confirmed);
  confirm.append(confirmTitle, confirmBody, confirmActions);
  confirm.hidden = true;
  confirm.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeConfirm(true);
  });

  function ask(intent: 'recordAgain' | 'discard', opener: HTMLButtonElement): void {
    confirming = { intent, opener };
    const replay = shown === 'replay-review';
    confirmTitle.textContent =
      intent === 'recordAgain'
        ? strings.recordAgainTitle
        : replay
          ? strings.discardReplayTitle
          : strings.discardTitle;
    confirmBody.textContent =
      intent === 'recordAgain'
        ? strings.recordAgainBody
        : replay
          ? strings.discardReplayBody
          : strings.discardBody;
    confirmed.textContent = intent === 'recordAgain' ? strings.recordAgain : strings.discard;
    for (const part of reviewActions()) part.hidden = true;
    confirm.hidden = false;
    cancel.focus();
  }

  /** Closes the confirmation; a cancel shows the choices again and returns focus to its opener. */
  function closeConfirm(cancelled: boolean): void {
    const opener = confirming?.opener;
    confirming = null;
    confirm.hidden = true;
    if (!cancelled || shown === undefined || !REVIEWS.includes(shown)) return;
    for (const part of reviewActions()) part.hidden = false;
    opener?.focus();
  }

  const brand = element('a', 'brand', strings.brand);
  brand.href = BRAND_URL;
  brand.target = '_blank';
  brand.rel = 'noopener noreferrer';

  panel.append(
    heading,
    message,
    start,
    choices,
    summary,
    describe,
    player,
    timer,
    actions,
    confirm,
  );
  root.append(panel, brand);
  ((doc.body as HTMLElement | null) ?? doc.documentElement).append(host);

  const parts: Record<string, HTMLElement> = {
    heading,
    start,
    choices,
    summary,
    describe,
    player,
    timer,
    message,
    ...buttons,
  };

  const messages: Partial<Record<PanelState, string>> = {
    loading: strings.loading,
    unavailable: strings.unavailable,
    busy: strings.busy,
    starting: strings.starting,
    paused: strings.paused,
    sending: strings.sending,
    done: strings.done,
    failed: strings.failed,
    unsupported: strings.unsupported,
  };
  const reasons = { size_limit: strings.sizeLimit, time_limit: strings.timeLimit };
  const refusals: Record<Refusal, string> = {
    reporter_required: strings.reporterRequired,
    invalid_reporter: strings.invalidReporter,
    hourly_cap: strings.hourlyCap,
    too_many_open: strings.tooManyOpen,
    rate_limited: strings.rateLimited,
  };
  /** In-app reporting's words for the ends a recording link words its own way. */
  const widgetMessages: Partial<Record<PanelState, string>> = {
    unavailable: strings.widgetUnavailable,
    failed: strings.widgetFailed,
    unsupported: strings.widgetUnsupported,
  };
  const replayMessages: Partial<Record<PanelState, string>> = {
    sending: strings.sendingReplay,
    done: strings.doneReplay,
  };

  /** What `render` shows beyond the state and the recording, to know when it changed. */
  const detailsOf = (snapshot: PanelSnapshot): string =>
    JSON.stringify([
      snapshot.widget === true,
      snapshot.refusal ?? null,
      snapshot.choices ?? null,
      snapshot.replay ?? null,
      snapshot.originRefused,
    ]);
  let shownDetails = '';

  let shownRecording: Blob | null = null;
  let playerUrl: string | undefined;
  let shownUnplayable = false;
  let last: PanelSnapshot | undefined;

  player.addEventListener('error', () => {
    // Only an error of the recording shown, not of the player being emptied.
    if (playerUrl === undefined || unplayable) return;
    unplayable = true;
    if (last !== undefined) overlay.render(last);
  });

  /** Stops showing the watched recording and lets go of its object URL. */
  function clearPlayer(): void {
    if (playerUrl === undefined) return;
    player.pause();
    player.removeAttribute('src');
    player.load();
    URL.revokeObjectURL(playerUrl);
    playerUrl = undefined;
  }

  /** The page's domain, named in the message of a refused origin. */
  function domain(): string {
    return doc.defaultView?.location.hostname ?? '';
  }

  const overlay: Overlay = {
    host,
    root,
    render(snapshot) {
      last = snapshot;
      if (snapshot.recording !== shownRecording) unplayable = false;
      const details = detailsOf(snapshot);
      if (
        snapshot.state === shown &&
        snapshot.recording === shownRecording &&
        unplayable === shownUnplayable &&
        details === shownDetails
      ) {
        return;
      }
      shownUnplayable = unplayable;
      shownDetails = details;
      const previous = shown;
      // Focus inside the panel moves to the next choice rather than being lost with a hidden button.
      const focused = root.activeElement;
      shown = snapshot.state;
      if (!REVIEWS.includes(snapshot.state) && confirming !== null) closeConfirm(false);
      panel.setAttribute(
        'aria-label',
        snapshot.widget === true ? strings.reportProblem : strings.recorder,
      );
      for (const [name, part] of Object.entries(parts)) {
        part.hidden = !(VISIBLE[name] ?? []).includes(snapshot.state);
      }
      const failedReview = snapshot.state === 'review' && unplayable;
      if (failedReview) {
        buttons.send.hidden = true;
        player.hidden = true;
      }
      replayChoice.hidden = snapshot.choices?.replay !== true;
      recordChoice.hidden = snapshot.choices?.record !== true;
      const replay = snapshot.replay ?? null;
      if (snapshot.state === 'replay-review' && replay !== null) {
        summarySpan.textContent = strings.replaySpan(formatTime(replay.durationMs));
        summaryPage.textContent = strings.replayPage(replay.page);
        summaryCounts.textContent = strings.replayCounts(
          replay.consoleErrors,
          replay.failedRequests,
        );
        if (previous !== 'replay-review') field.value = '';
      }
      if (confirming !== null) for (const part of reviewActions()) part.hidden = true;
      panel.classList.toggle(
        'wide',
        (snapshot.state === 'review' && !failedReview) || snapshot.state === 'replay-review',
      );
      heading.textContent =
        snapshot.state === 'choosing'
          ? strings.choose
          : snapshot.state === 'replay-review'
            ? strings.replayReview
            : snapshot.state !== 'review'
              ? strings.ready
              : failedReview
                ? strings.unplayable
                : strings.review;
      let text = failedReview ? strings.unplayableBody : (messages[snapshot.state] ?? '');
      if (snapshot.widget === true) text = widgetMessages[snapshot.state] ?? text;
      if (replay !== null) text = replayMessages[snapshot.state] ?? text;
      const refusal = snapshot.refusal ?? null;
      if (refusal !== null && (snapshot.state === 'busy' || snapshot.state === 'unavailable'))
        text = refusals[refusal];
      if (snapshot.state === 'failed' && snapshot.originRefused) {
        text = strings.originRefused(domain());
      }
      const told =
        snapshot.state === 'review' || snapshot.state === 'sending' || snapshot.state === 'done';
      message.textContent =
        told && snapshot.stopReason !== null
          ? `${reasons[snapshot.stopReason]} ${text}`.trim()
          : text;
      message.hidden = message.hidden || message.textContent === '';
      if (snapshot.state === 'ready') showMicrophone(snapshot.microphone);
      if (snapshot.recording !== shownRecording) {
        clearPlayer();
        shownRecording = snapshot.recording;
        if (shownRecording !== null) {
          playerUrl = URL.createObjectURL(shownRecording);
          player.src = playerUrl;
        }
      }
      const timed = (state: PanelState | undefined) => state === 'recording' || state === 'paused';
      if (timed(snapshot.state) && !timed(previous)) {
        timer.textContent = `${formatTime(0)} / ${formatTime(snapshot.maxDurationMs)}`;
      }
      if (snapshot.state !== previous && snapshot.state === 'choosing') {
        (replayChoice.hidden ? recordChoice : replayChoice).focus();
      } else if (snapshot.state !== previous && snapshot.state === 'replay-review') {
        field.focus();
      } else if (
        focused instanceof HTMLElement &&
        (focused.hidden || focused.closest('[hidden]') !== null)
      ) {
        const next = [record, replayChoice, recordChoice, ...Object.values(buttons)].find(
          (candidate) => !candidate.hidden && candidate.closest('[hidden]') === null,
        );
        next?.focus();
      }
    },
    tick(elapsedMs, maxMs) {
      timer.textContent = `${formatTime(elapsedMs)} / ${formatTime(maxMs)}`;
    },
    remove() {
      clearPlayer();
      host.remove();
    },
  };
  return overlay;
}
