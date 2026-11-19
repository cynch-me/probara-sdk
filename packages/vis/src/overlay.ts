/**
 * The recorder's controls on the page: one host element holding a shadow root (closed unless a
 * test asks), so the page's styles and scripts cannot reach in and its own styles cannot leak
 * out. Built with DOM calls only (no `innerHTML`, no inline `<style>` when constructed
 * stylesheets exist), so a strict Content Security Policy or Trusted Types do not stop it.
 *
 * One floating card, in the look of Probara's recording page: the Probara Vis mark and link at the
 * top, a ready card ("Ready to record?", a Microphone switch and Start recording), whether it is
 * recording or paused with the time against the limit, and once stopped the recording itself in
 * the browser's own player before choosing Send, Record again or Discard; the last two ask first,
 * in place of the review. A recording the player cannot play (an `error` of the video element,
 * such as a decode failure) is never offered for sending: the panel says so and offers Record
 * again and Discard only. Its colours follow the page's `color-scheme`: dark on a dark page.
 */
import type { RecorderSnapshot, RecorderState } from './controller.js';
import type { Strings } from './i18n.js';
import type { Refusal } from './intake.js';
import { drawMark } from './mark.js';

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
  /** What happened, as typed before the review was closed: shown again when it opens. */
  draft?: string;
}

/** The longest description of what happened. */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** The attribute of the overlay's host element. */
export const OVERLAY_ATTRIBUTE = 'data-probara-vis-recorder';

/** Where the brand link at the top of the panel goes. */
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
  /** What happened, as typed so far in the review of an instant replay. */
  draft(): string;
  remove(): void;
}

/** The light colours, then both through `light-dark()` where a browser has it. */
const CSS = `
:host { all: initial; color-scheme: inherit;
  --pv-card: #fdfcfe; --pv-fg: #1f1e25; --pv-muted: #646071; --pv-border: #e4e3ea; --pv-input: #e4e3ea;
  --pv-surface-1: #f5f5f9; --pv-surface-2: #f0eff4; --pv-surface-3: #eae8ef; --pv-hover: #1f1e250f; --pv-primary:
  #724fbc; --pv-primary-fg: #fdfcfe; --pv-destructive: #bd413f; --pv-destructive-soft: #bd413f1a; --pv-ok: #448052; --pv-shadow-near: #0c0b0f1f; --pv-shadow-far: #0c0b0f59; }
@supports (color: light-dark(#000, #fff)) {
  :host {
    --pv-card: light-dark(#fdfcfe, #16151a);
    --pv-fg: light-dark(#1f1e25, #f0eff4);
    --pv-muted: light-dark(#646071, #a4a0b1);
    --pv-border: light-dark(#e4e3ea, #fdfcfe1a);
    --pv-input: light-dark(#e4e3ea, #fdfcfe26);
    --pv-surface-1: light-dark(#f5f5f9, #1a191f);
    --pv-surface-2: light-dark(#f0eff4, #1f1e25);
    --pv-surface-3: light-dark(#eae8ef, #28262f);
    --pv-hover: light-dark(#1f1e250f, #f0eff414);
    --pv-primary: light-dark(#724fbc, #a890e8);
    --pv-primary-fg: light-dark(#fdfcfe, #16151a);
    --pv-destructive: light-dark(#bd413f, #d96f6f);
    --pv-destructive-soft: light-dark(#bd413f1a, #d96f6f1a);
    --pv-ok: light-dark(#448052, #7fb482);
    --pv-shadow-near: light-dark(#0c0b0f1f, #06050880);
    --pv-shadow-far: light-dark(#0c0b0f59, #060508b3);
  }
}
.card { position: relative; box-sizing: border-box; width: min(360px, calc(100vw - 32px));
  padding: 12px 16px 16px; border: 1px solid var(--pv-border); border-radius: 16px;
  background: var(--pv-card); color: var(--pv-fg);
  box-shadow: 0 2px 6px var(--pv-shadow-near), 0 30px 70px -20px var(--pv-shadow-far);
  font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
.card.wide { width: min(400px, calc(100vw - 32px)); }
.top { display: flex; align-items: center; min-height: 28px; margin: 0 0 8px; padding-right: 28px; }
.brand { display: inline-flex; align-items: center; gap: 7px; color: var(--pv-muted);
  font-size: 11.5px; font-weight: 600; line-height: 1; text-decoration: none; }
.brand:hover { text-decoration: underline; }
.mark { display: block; flex: none; width: 22px; height: 12px; }
.body { display: flex; flex-direction: column; gap: 14px; }
.heading { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3; letter-spacing: -0.012em; }
button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; height: 32px; padding: 0 10px; border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: inherit; font: 500 13px/1 system-ui, -apple-system, 'Segoe UI',
  Roboto, sans-serif; white-space: nowrap; cursor: pointer; }
button svg { flex: none; }
button:disabled { cursor: progress; opacity: 0.85; }
button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 2px solid var(--pv-primary);
  outline-offset: 2px; }
.primary { background: var(--pv-primary); color: var(--pv-primary-fg); }
.primary:hover:enabled { filter: brightness(1.08); }
.outline { border-color: var(--pv-border); background: var(--pv-card); }
.outline:hover, .ghost:hover, .close:hover, .choice:hover { background: var(--pv-hover); }
.ghost { color: var(--pv-muted); }
.ghost:hover { color: var(--pv-fg); }
.danger { border-color: var(--pv-border); background: var(--pv-card); color: var(--pv-destructive); }
.danger:hover { border-color: var(--pv-destructive); }
.wide-button { width: 100%; height: 36px; }
.close { position: absolute; top: 12px; right: 10px; width: 28px; height: 28px; padding: 0;
  color: var(--pv-muted); }
.close:hover { color: var(--pv-fg); }
.row { box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%;
  margin: 0; padding: 8px 10px 8px 12px; border: 1px solid var(--pv-border); border-radius: 8px; }
.row > svg { color: var(--pv-muted); flex: none; }
.row-label { flex: 1; text-align: left; font-weight: 500; }
.choices { display: flex; flex-direction: column; gap: 8px; }
.choice { height: auto; font-weight: 400; }
.row-icon { display: grid; color: var(--pv-muted); }
.spin { box-sizing: border-box; width: 14px; height: 14px; border: 2px solid currentColor;
  border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.switch { position: relative; width: 36px; height: 20px; padding: 0; border: 2px solid transparent;
  border-radius: 999px; background: var(--pv-input); flex: none; }
.switch::after { content: ''; position: absolute; top: 0; left: 0; width: 16px; height: 16px;
  border-radius: 50%; background: var(--pv-card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s; }
.switch[aria-checked='true'] { background: var(--pv-primary); }
.switch[aria-checked='true']::after { transform: translateX(16px); }
.status { display: flex; flex-direction: column; gap: 10px; }
.status-line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.status-label { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.timer { color: var(--pv-muted); font-variant-numeric: tabular-nums; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pv-destructive);
  animation: blink 1.4s ease-in-out infinite; }
.dot.paused { background: var(--pv-muted); animation: none; }
@keyframes blink { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
.progress { position: relative; height: 6px; overflow: hidden; border-radius: 999px;
  background: var(--pv-surface-2); }
.progress > i { position: absolute; inset: 0 auto 0 0; border-radius: inherit;
  background: var(--pv-primary); }
.indeterminate > i { width: 35%; animation: slide 1.4s ease-in-out infinite; }
@keyframes slide { from { left: -35%; } to { left: 100%; } }
.controls { display: flex; gap: 8px; }
.controls > button { flex: 1 1 auto; padding: 0 8px; }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.player { display: block; box-sizing: border-box; width: 100%; aspect-ratio: 16 / 9;
  border-radius: 8px; background: #000; box-shadow: 0 0 0 1px var(--pv-border); }
.msg { display: flex; align-items: flex-start; gap: 7px; }
.msg-icon { display: grid; place-items: center; flex: none; width: 22px; height: 20px;
  color: var(--pv-muted); }
.msg-icon.ok { color: var(--pv-ok); }
.msg-text { flex: 1; min-width: 0; }
.msg-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.message { margin: 0; line-height: 20px; }
.msg-title:not([hidden]) + .message { margin-top: 2px; color: var(--pv-muted); line-height: 1.45; }
.notice, .problem { display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 8px 10px;
  border-radius: 8px; font-size: 12.5px; }
.notice { background: var(--pv-surface-1); color: var(--pv-muted); }
.notice svg { margin-top: 2px; flex: none; }
.problem { background: var(--pv-destructive-soft); color: var(--pv-destructive); }
.sending { display: flex; flex-direction: column; gap: 14px; text-align: center; }
.skeleton { display: flex; flex-direction: column; gap: 12px; }
.skeleton > i { display: block; height: 40px; border-radius: 8px; background: var(--pv-surface-3);
  animation: fade 1.6s ease-in-out infinite; }
.skeleton > i:first-child { width: 72%; height: 24px; }
@keyframes fade { 50% { opacity: 0.55; } }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; }
.facts { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px;
  background: var(--pv-surface-1); color: var(--pv-muted); font-size: 12.5px; }
.facts p { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0; }
.facts p > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.describe { display: flex; flex-direction: column; gap: 6px; }
.describe label { font-weight: 500; font-size: 12.5px; }
.describe textarea { box-sizing: border-box; width: 100%; min-height: 72px; padding: 7px 10px;
  border: 1px solid var(--pv-input); border-radius: 8px; background: transparent; color: inherit;
  font: inherit; resize: vertical; }
.confirm-title { margin: 0; color: var(--pv-destructive); font-size: 14px; font-weight: 600; }
.confirm-body { margin: 6px 0 16px; color: var(--pv-muted); }
@media (max-width: 440px) { .actions { flex-wrap: wrap; } }
@media (prefers-reduced-motion: reduce) {
  .dot, .skeleton > i, .indeterminate > i, .spin { animation: none; }
  .switch::after { transition: none; }
}
[hidden] { display: none !important; }
`;

const VISIBLE: Readonly<Record<string, readonly PanelState[]>> = {
  heading: ['ready', 'starting', 'review', 'choosing', 'replay-review'],
  skeleton: ['loading'],
  microphoneRow: ['ready', 'starting'],
  record: ['ready', 'starting'],
  choices: ['choosing'],
  summary: ['replay-review'],
  describe: ['replay-review'],
  player: ['review'],
  status: ['recording', 'paused'],
  controls: ['recording', 'paused'],
  stop: ['recording', 'paused'],
  discardNow: ['recording', 'paused'],
  pause: ['recording'],
  resume: ['paused'],
  msg: ['unavailable', 'busy', 'done', 'failed', 'unsupported'],
  sending: ['sending'],
  actions: ['review', 'replay-review'],
  discard: ['review', 'replay-review'],
  send: ['review', 'replay-review'],
  recordAgain: ['review'],
  close: [
    'loading',
    'unavailable',
    'busy',
    'ready',
    'done',
    'failed',
    'unsupported',
    'choosing',
    'replay-review',
  ],
};

/** The states that review something before it is sent, and ask before discarding it. */
const REVIEWS: readonly PanelState[] = ['review', 'replay-review'];

/** The 24-unit outlines of the panel's stroke icons. */
const ICONS = {
  video:
    'm16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  micOff:
    'm2 2 20 20M18.89 13.23A7.12 7.12 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12M12 19v3',
  pause:
    'M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1zM15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z',
  play: 'M7 4.5v15l12.5-7.5z',
  stop: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  again: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
  send: 'M22 2 11 13M22 2 15 22l-4-9-9-4z',
  x: 'M18 6 6 18M6 6l12 12',
  alert:
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
  history: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2zM7 11V7a5 5 0 0 1 10 0v4',
  clock: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 6v6l4 2',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  chev: 'm9 18 6-6-6-6',
  unlink:
    'm18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71M5.17 11.75l-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3',
  monitor:
    'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM8 21h8M12 17v4',
  timer: 'M10 2h4M12 14l3-3M4 14a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
  circleCheck: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M9 12l2 2 4-4',
} as const;

type IconName = keyof typeof ICONS;

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

  /** A stroke icon, 16px unless sized, hidden from assistive technology. */
  const icon = (name: IconName, size = 16): SVGSVGElement => {
    const svg = doc.createElementNS(SVG, 'svg');
    for (const [attribute, value] of [
      ['width', String(size)],
      ['height', String(size)],
      ['viewBox', '0 0 24 24'],
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '2'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['aria-hidden', 'true'],
      ['focusable', 'false'],
    ] as const) {
      svg.setAttribute(attribute, value);
    }
    const outline = doc.createElementNS(SVG, 'path');
    outline.setAttribute('d', ICONS[name]);
    svg.append(outline);
    return svg;
  };

  /** A button with its icon before its words. */
  const button = (
    text: string,
    onClick: () => void,
    className: string,
    iconName?: IconName,
  ): HTMLButtonElement => {
    const created = element('button', className);
    created.type = 'button';
    if (iconName !== undefined) created.append(icon(iconName));
    created.append(element('span', undefined, text));
    created.addEventListener('click', onClick);
    return created;
  };

  const panel = element('div', 'card');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', strings.recorder);

  const brand = element('a', 'brand');
  brand.append(drawMark(doc, 'brand'), strings.brand);
  brand.href = BRAND_URL;
  brand.target = '_blank';
  brand.rel = 'noopener noreferrer';
  const top = element('div', 'top');
  top.append(brand);

  const heading = element('p', 'heading');

  const skeleton = element('div', 'skeleton');
  const loading = element('p', 'visually-hidden', strings.loading);
  loading.setAttribute('role', 'status');
  skeleton.append(element('i'), element('i'), element('i'), loading);

  let microphoneOn = false;
  const microphoneIcon = element('span', 'row-icon');
  const microphoneLabel = element('span', 'row-label', strings.microphone);
  microphoneLabel.id = 'probara-vis-microphone';
  const microphone = element('button', 'switch');
  microphone.type = 'button';
  microphone.setAttribute('role', 'switch');
  microphone.setAttribute('aria-labelledby', microphoneLabel.id);
  microphone.addEventListener('click', () => {
    showMicrophone(!microphoneOn);
    handlers.onMicrophone(microphoneOn);
  });
  const microphoneRow = element('label', 'row');
  microphoneRow.append(microphoneIcon, microphoneLabel, microphone);
  function showMicrophone(on: boolean): void {
    microphoneOn = on;
    microphone.setAttribute('aria-checked', String(on));
    microphoneIcon.replaceChildren(icon(on ? 'mic' : 'micOff'));
  }
  showMicrophone(false);

  const record = element('button', 'primary wide-button');
  record.type = 'button';
  record.addEventListener('click', () => {
    handlers.onRecord();
  });
  /** Start recording, or busy while the browser asks what to share. */
  function showRecord(starting: boolean): void {
    record.disabled = starting;
    microphone.disabled = starting;
    record.replaceChildren(
      starting ? element('span', 'spin') : icon('video'),
      element('span', undefined, starting ? strings.starting : strings.record),
    );
  }
  showRecord(false);

  /** What the open confirmation asks for, and the button that opened it. */
  let confirming: { intent: 'recordAgain' | 'discard'; opener: HTMLButtonElement } | null = null;
  let shown: PanelState | undefined;

  const choice = (text: string, iconName: IconName, onClick: () => void): HTMLButtonElement => {
    const created = element('button', 'row choice');
    created.type = 'button';
    created.append(icon(iconName), element('span', 'row-label', text), icon('chev'));
    created.addEventListener('click', onClick);
    return created;
  };
  const replayChoice = choice(strings.sendWhatHappened, 'history', () => {
    handlers.onChooseReplay?.();
  });
  const recordChoice = choice(strings.recordFromStart, 'video', () => {
    handlers.onChooseRecord?.();
  });
  const choices = element('div', 'choices');
  choices.append(replayChoice, recordChoice);

  const summarySpan = element('span');
  const summaryPage = element('span');
  const fact = (iconName: IconName, text: HTMLElement): HTMLParagraphElement => {
    const line = element('p');
    line.append(icon(iconName, 15), text);
    return line;
  };
  const summary = element('div', 'facts');
  summary.append(fact('history', summarySpan), fact('link', summaryPage));

  const describe = element('div', 'describe');
  const field = element('textarea');
  field.id = 'probara-vis-description';
  field.maxLength = MAX_DESCRIPTION_LENGTH;
  field.rows = 3;
  const fieldLabel = element('label', undefined, strings.whatHappened);
  fieldLabel.htmlFor = field.id;
  describe.append(fieldLabel, field);

  const player = element('video', 'player');
  player.controls = true;
  player.playsInline = true;
  player.preload = 'metadata';
  player.setAttribute('aria-label', strings.player);

  const statusDot = element('span', 'dot');
  const statusLabel = element('span');
  const timer = element('span', 'timer');
  timer.id = 'probara-vis-timer';
  timer.setAttribute('aria-live', 'off');
  const statusState = element('span', 'status-label');
  statusState.setAttribute('role', 'status');
  statusState.append(statusDot, statusLabel);
  const statusLine = element('div', 'status-line');
  statusLine.append(statusState, timer);
  const elapsed = element('i');
  const progress = element('div', 'progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-labelledby', timer.id);
  progress.append(elapsed);
  const status = element('div', 'status');
  status.append(statusLine, progress);
  /** The recorded time against the limit, in words and on the bar. */
  function showTime(elapsedMs: number, maxMs: number): void {
    timer.textContent = strings.timer(formatTime(elapsedMs), formatTime(maxMs));
    const share = maxMs > 0 ? Math.min(100, Math.round((elapsedMs / maxMs) * 100)) : 0;
    elapsed.style.setProperty('width', `${String(share)}%`);
    progress.setAttribute('aria-valuenow', String(share));
  }

  const buttons = {
    stop: button(
      strings.stop,
      () => {
        handlers.onStop();
      },
      'primary',
      'stop',
    ),
    pause: button(
      strings.pause,
      () => {
        handlers.onPause();
      },
      'outline',
      'pause',
    ),
    resume: button(
      strings.resume,
      () => {
        handlers.onResume();
      },
      'outline',
      'play',
    ),
    // While recording it discards at once, as it always has; a watched recording asks first.
    discardNow: button(
      strings.discard,
      () => {
        handlers.onDiscard();
      },
      'ghost',
      'trash',
    ),
    discard: button(
      strings.discard,
      () => {
        ask('discard', buttons.discard);
      },
      'ghost',
      'trash',
    ),
    recordAgain: button(
      strings.recordAgain,
      () => {
        ask('recordAgain', buttons.recordAgain);
      },
      'outline',
      'again',
    ),
    send: button(
      strings.send,
      () => {
        if (shown === 'replay-review')
          handlers.onSend(field.value.trim().slice(0, MAX_DESCRIPTION_LENGTH));
        else handlers.onSend();
      },
      'primary',
      'send',
    ),
  };
  const controls = element('div', 'controls');
  controls.append(buttons.stop, buttons.pause, buttons.resume, buttons.discardNow);
  const actions = element('div', 'actions');
  actions.append(buttons.discard, buttons.recordAgain, buttons.send);

  const close = element('button', 'close');
  close.type = 'button';
  close.append(icon('x'), element('span', 'visually-hidden', strings.close));
  close.addEventListener('click', () => {
    handlers.onClose();
  });

  const msgIcon = element('span', 'msg-icon');
  const msgTitle = element('p', 'msg-title');
  const message = element('p', 'message');
  const msgText = element('div', 'msg-text');
  msgText.setAttribute('role', 'status');
  msgText.append(msgTitle, message);
  const msg = element('div', 'msg');
  msg.append(msgIcon, msgText);

  const sendingTitle = element('p', 'heading');
  sendingTitle.setAttribute('role', 'status');
  const sendingBar = element('div', 'progress indeterminate');
  sendingBar.append(element('i'));
  const sending = element('div', 'sending');
  sending.append(sendingTitle, sendingBar);

  const notice = element('p', 'notice');
  const noticeText = element('span');
  notice.append(icon('timer', 15), noticeText);
  const problem = element('p', 'problem');
  problem.setAttribute('role', 'alert');

  /** The watched recording could not be played: it is not offered for sending. */
  let unplayable = false;

  const confirm = element('div', 'confirm');
  confirm.setAttribute('role', 'alertdialog');
  const confirmTitle = element('p', 'confirm-title');
  confirmTitle.id = 'probara-vis-confirm-title';
  const confirmBody = element('p', 'confirm-body');
  confirmBody.id = 'probara-vis-confirm-body';
  confirm.setAttribute('aria-labelledby', confirmTitle.id);
  confirm.setAttribute('aria-describedby', confirmBody.id);
  const cancel = button(
    strings.cancel,
    () => {
      closeConfirm(true);
    },
    'outline',
  );
  const confirmedLabel = element('span');
  const confirmed = element('button', 'danger');
  confirmed.type = 'button';
  confirmed.append(confirmedLabel);
  confirmed.addEventListener('click', () => {
    const intent = confirming?.intent;
    closeConfirm(false);
    if (intent === 'recordAgain') handlers.onRecordAgain();
    else if (intent === 'discard') handlers.onDiscard();
  });
  const confirmActions = element('div', 'actions');
  confirmActions.append(cancel, confirmed);
  confirm.append(confirmTitle, confirmBody, confirmActions);
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
    confirmedLabel.textContent = intent === 'recordAgain' ? strings.recordAgain : strings.discard;
    layout();
    cancel.focus();
  }

  /** Closes the confirmation; a cancel shows the review again and returns focus to its opener. */
  function closeConfirm(cancelled: boolean): void {
    const opener = confirming?.opener;
    confirming = null;
    layout();
    if (cancelled && shown !== undefined && REVIEWS.includes(shown)) opener?.focus();
  }

  const body = element('div', 'body');
  body.append(
    heading,
    skeleton,
    msg,
    sending,
    notice,
    microphoneRow,
    record,
    choices,
    summary,
    describe,
    player,
    problem,
    status,
    actions,
    controls,
    confirm,
  );
  panel.append(top, body, close);
  root.append(panel);
  ((doc.body as HTMLElement | null) ?? doc.documentElement).append(host);

  const parts: Record<string, HTMLElement> = {
    heading,
    skeleton,
    microphoneRow,
    record,
    choices,
    summary,
    describe,
    player,
    status,
    controls,
    msg,
    sending,
    actions,
    close,
    ...buttons,
  };

  const reasons = { size_limit: strings.sizeLimit, time_limit: strings.timeLimit };
  const refusals: Record<Refusal, string> = {
    reporter_required: strings.reporterRequired,
    invalid_reporter: strings.invalidReporter,
    hourly_cap: strings.hourlyCap,
    too_many_open: strings.tooManyOpen,
    rate_limited: strings.rateLimited,
  };
  /** The refusals that ask the visitor to sign in again, rather than to wait. */
  const signIn: readonly Refusal[] = ['reporter_required', 'invalid_reporter'];

  /** What the panel says at an end: its icon, an optional title and the words. */
  function messageOf(snapshot: PanelSnapshot): {
    icon: IconName;
    title?: string;
    text: string;
  } {
    const refusal = snapshot.refusal ?? null;
    const widget = snapshot.widget === true;
    switch (snapshot.state) {
      case 'done':
        return (snapshot.replay ?? null) !== null
          ? { icon: 'circleCheck', text: strings.doneReplay }
          : { icon: 'circleCheck', title: strings.done, text: '' };
      case 'failed':
        return {
          icon: 'alert',
          text: snapshot.originRefused
            ? strings.originRefused(domain())
            : widget
              ? strings.widgetFailed
              : strings.failed,
        };
      case 'unsupported':
        return widget
          ? { icon: 'monitor', text: strings.widgetUnsupported }
          : { icon: 'monitor', title: strings.unsupported, text: strings.unsupportedBody };
      case 'busy':
      case 'unavailable':
        if (refusal !== null)
          return { icon: signIn.includes(refusal) ? 'lock' : 'clock', text: refusals[refusal] };
        if (snapshot.state === 'busy')
          return widget
            ? { icon: 'clock', text: strings.busyBody }
            : { icon: 'clock', title: strings.busy, text: strings.busyBody };
        return widget
          ? { icon: 'unlink', text: strings.widgetUnavailable }
          : { icon: 'unlink', title: strings.unavailable, text: strings.unavailableBody };
      default:
        return { icon: 'alert', text: '' };
    }
  }

  /** Shows the parts of the state shown, or only the confirmation while it asks. */
  function layout(): void {
    const state = shown;
    for (const [name, part] of Object.entries(parts)) {
      part.hidden = state === undefined || !(VISIBLE[name] ?? []).includes(state);
    }
    const snapshot = last;
    const failedReview = state === 'review' && unplayable;
    if (failedReview) buttons.send.hidden = true;
    problem.hidden = !failedReview;
    problem.textContent = failedReview ? strings.unplayable : '';
    replayChoice.hidden = snapshot?.choices?.replay !== true;
    recordChoice.hidden = snapshot?.choices?.record !== true;
    const told = state === 'review' || state === 'sending' || state === 'done';
    notice.hidden = !told || (snapshot?.stopReason ?? null) === null;
    confirm.hidden = confirming === null;
    if (confirming !== null) {
      for (const part of [...body.children, ...Object.values(buttons)]) {
        if (part !== confirm) (part as HTMLElement).hidden = true;
      }
    }
  }

  /** What `render` shows beyond the state and the recording, to know when it changed. */
  const detailsOf = (snapshot: PanelSnapshot): string =>
    JSON.stringify([
      snapshot.widget === true,
      snapshot.refusal ?? null,
      snapshot.choices ?? null,
      snapshot.replay ?? null,
      snapshot.originRefused,
      snapshot.stopReason,
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
      if (!REVIEWS.includes(snapshot.state) && confirming !== null) confirming = null;
      panel.setAttribute(
        'aria-label',
        snapshot.widget === true ? strings.reportProblem : strings.recorder,
      );
      layout();
      const wide = snapshot.state === 'review' || snapshot.state === 'replay-review';
      panel.classList.toggle('wide', wide);
      heading.textContent =
        snapshot.state === 'choosing'
          ? strings.choose
          : snapshot.state === 'replay-review'
            ? strings.replayReview
            : snapshot.state === 'review'
              ? strings.review
              : strings.ready;
      const replay = snapshot.replay ?? null;
      if (snapshot.state === 'replay-review' && replay !== null) {
        summarySpan.textContent = strings.replaySpan(formatTime(replay.durationMs));
        summaryPage.textContent = strings.replayPage(replay.page);
        if (previous !== 'replay-review') field.value = snapshot.draft ?? '';
      }
      const said = messageOf(snapshot);
      msgIcon.replaceChildren(icon(said.icon));
      msgIcon.classList.toggle('ok', said.icon === 'circleCheck');
      msgTitle.textContent = said.title ?? '';
      msgTitle.hidden = said.title === undefined;
      message.textContent = said.text;
      message.hidden = said.text === '';
      sendingTitle.textContent = replay !== null ? strings.sendingReplay : strings.sending;
      noticeText.textContent = snapshot.stopReason !== null ? reasons[snapshot.stopReason] : '';
      statusLabel.textContent = snapshot.state === 'paused' ? strings.paused : strings.recording;
      statusDot.classList.toggle('paused', snapshot.state === 'paused');
      showRecord(snapshot.state === 'starting');
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
      if (timed(snapshot.state) && !timed(previous)) showTime(0, snapshot.maxDurationMs);
      if (snapshot.state !== previous && snapshot.state === 'choosing') {
        (replayChoice.hidden ? recordChoice : replayChoice).focus();
      } else if (snapshot.state !== previous && snapshot.state === 'replay-review') {
        field.focus();
      } else if (
        focused instanceof HTMLElement &&
        (focused.hidden || focused.closest('[hidden]') !== null)
      ) {
        const next = [record, replayChoice, recordChoice, ...Object.values(buttons), close].find(
          (candidate) =>
            !candidate.hidden && !candidate.disabled && candidate.closest('[hidden]') === null,
        );
        next?.focus();
      }
    },
    tick(elapsedMs, maxMs) {
      showTime(elapsedMs, maxMs);
    },
    draft() {
      return field.value;
    },
    remove() {
      clearPlayer();
      host.remove();
    },
  };
  return overlay;
}
