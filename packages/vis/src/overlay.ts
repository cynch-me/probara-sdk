/**
 * The recorder's controls on the page: one host element holding a shadow root (closed unless a
 * test asks), so the page's styles and scripts cannot reach in and its own styles cannot leak
 * out. Built with DOM calls only (no `innerHTML`, no inline `<style>` when constructed
 * stylesheets exist), so a strict Content Security Policy or Trusted Types do not stop it.
 */
import type { RecorderSnapshot, RecorderState } from './controller.js';
import type { Strings } from './i18n.js';

/** The attribute of the overlay's host element. */
export const OVERLAY_ATTRIBUTE = 'data-probara-vis-recorder';

export interface OverlayHandlers {
  onTitle(title: string): void;
  onMicrophone(on: boolean): void;
  onRecord(): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onDiscard(): void;
  onClose(): void;
}

export interface Overlay {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  render(snapshot: RecorderSnapshot): void;
  /** Shows the recorded time against the limit. */
  tick(elapsedMs: number, maxMs: number): void;
  remove(): void;
}

const CSS = `
:host { all: initial; }
.panel { box-sizing: border-box; width: 300px; padding: 14px 16px; border-radius: 12px;
  background: #ffffff; color: #1b1d21; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
  font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.heading { margin: 0 0 10px; font-size: 15px; font-weight: 600; }
.message { margin: 0 0 10px; }
.field { display: block; margin: 0 0 10px; }
.field input[type='text'] { box-sizing: border-box; width: 100%; margin-top: 4px; padding: 6px 8px;
  border: 1px solid #c4c8cf; border-radius: 6px; font: inherit; color: inherit; background: #fff; }
.check { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; }
.limit { margin: 0 0 12px; color: #5b616b; font-size: 12px; }
.timer { margin: 0 0 10px; font-variant-numeric: tabular-nums; font-size: 20px; font-weight: 600; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { padding: 6px 12px; border: 1px solid #c4c8cf; border-radius: 6px; background: #fff;
  color: inherit; font: inherit; cursor: pointer; }
button.primary { border-color: #3a5bd9; background: #3a5bd9; color: #fff; }
[hidden] { display: none !important; }
`;

const VISIBLE: Readonly<Record<string, readonly RecorderState[]>> = {
  heading: ['ready'],
  title: ['ready'],
  microphone: ['ready'],
  limit: ['ready'],
  timer: ['recording', 'paused'],
  message: ['loading', 'unavailable', 'busy', 'starting', 'paused', 'sending', 'done', 'failed'],
  record: ['ready'],
  pause: ['recording'],
  resume: ['paused'],
  stop: ['recording', 'paused'],
  discard: ['recording', 'paused'],
  close: ['loading', 'unavailable', 'busy', 'ready', 'done', 'failed'],
};

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

  const panel = element('div', 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', strings.recorder);
  const heading = element('p', 'heading');
  const message = element('p', 'message');
  message.setAttribute('role', 'status');
  const titleField = element('label', 'field', strings.titleLabel);
  const titleInput = element('input');
  titleInput.type = 'text';
  titleInput.maxLength = 200;
  titleInput.addEventListener('input', () => {
    handlers.onTitle(titleInput.value);
  });
  titleField.append(titleInput);
  const microphone = element('label', 'check');
  const microphoneInput = element('input');
  microphoneInput.type = 'checkbox';
  microphoneInput.addEventListener('change', () => {
    handlers.onMicrophone(microphoneInput.checked);
  });
  microphone.append(microphoneInput, doc.createTextNode(strings.microphone));
  const limit = element('p', 'limit');
  const timer = element('p', 'timer');
  timer.setAttribute('aria-live', 'off');

  const button = (text: string, onClick: () => void, primary = false): HTMLButtonElement => {
    const created = element('button', primary ? 'primary' : undefined, text);
    created.type = 'button';
    created.addEventListener('click', onClick);
    return created;
  };
  const buttons = {
    record: button(
      strings.record,
      () => {
        handlers.onRecord();
      },
      true,
    ),
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
      true,
    ),
    discard: button(strings.discard, () => {
      handlers.onDiscard();
    }),
    close: button(strings.close, () => {
      handlers.onClose();
    }),
  };
  const actions = element('div', 'actions');
  actions.append(...Object.values(buttons));
  panel.append(heading, message, titleField, microphone, limit, timer, actions);
  root.append(panel);
  ((doc.body as HTMLElement | null) ?? doc.documentElement).append(host);

  const parts: Record<string, HTMLElement> = {
    heading,
    title: titleField,
    microphone,
    limit,
    timer,
    message,
    ...buttons,
  };

  const messages: Partial<Record<RecorderState, string>> = {
    loading: strings.loading,
    unavailable: strings.unavailable,
    busy: strings.busy,
    starting: strings.starting,
    paused: strings.paused,
    sending: strings.sending,
    done: strings.done,
    failed: strings.failed,
  };

  let shown: RecorderState | undefined;

  return {
    host,
    root,
    render(snapshot) {
      if (snapshot.state === shown) return;
      const previous = shown;
      shown = snapshot.state;
      for (const [name, part] of Object.entries(parts)) {
        part.hidden = !(VISIBLE[name] ?? []).includes(snapshot.state);
      }
      message.textContent = messages[snapshot.state] ?? '';
      if (snapshot.link !== null) {
        heading.textContent = strings.heading(snapshot.link.organizationName);
        limit.textContent = strings.limit(Math.round(snapshot.maxDurationMs / 60_000));
      }
      if (snapshot.state === 'ready') {
        titleInput.value = snapshot.title;
        microphoneInput.checked = snapshot.microphone;
      }
      const timed = (state: RecorderState | undefined) =>
        state === 'recording' || state === 'paused';
      if (timed(snapshot.state) && !timed(previous)) {
        timer.textContent = `${formatTime(0)} / ${formatTime(snapshot.maxDurationMs)}`;
      }
    },
    tick(elapsedMs, maxMs) {
      timer.textContent = `${formatTime(elapsedMs)} / ${formatTime(maxMs)}`;
    },
    remove() {
      host.remove();
    },
  };
}
