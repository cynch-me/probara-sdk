/**
 * The optional floating launcher of in-app reporting: one pill with the Probara mark and its label
 * in a shadow root, as the panel is, built with DOM calls only. Its colours follow the page
 * through the CSS custom properties `--probara-vis-accent` (background) and
 * `--probara-vis-accent-contrast` (text and mark); unless set, the panel's card colours, dark on a
 * page whose `color-scheme` is dark.
 */
import { drawMark } from './mark.js';

/** The attribute of the launcher's host element. */
export const LAUNCHER_ATTRIBUTE = 'data-probara-vis-launcher';

export type LauncherPosition = 'bottom-right' | 'bottom-left';

export interface Launcher {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** Shows or hides the button. */
  show(visible: boolean): void;
  remove(): void;
}

const CSS = `
:host { all: initial; color-scheme: inherit; --pv-card: #fdfcfe; --pv-fg: #1f1e25; --pv-border: #e4e3ea;
  --pv-shadow-near: #0c0b0f1f; --pv-shadow-far: #0c0b0f59; }
@supports (color: light-dark(#000, #fff)) {
  :host { --pv-card: light-dark(#fdfcfe, #16151a); --pv-fg: light-dark(#1f1e25, #f0eff4);
    --pv-border: light-dark(#e4e3ea, #fdfcfe1a);
    --pv-shadow-near: light-dark(#0c0b0f1f, #06050880);
    --pv-shadow-far: light-dark(#0c0b0f59, #060508b3); }
}
button { box-sizing: border-box; display: inline-flex; align-items: center; gap: 9px; height: 38px;
  padding: 0 16px 0 13px; border: 1px solid var(--probara-vis-accent, var(--pv-border));
  border-radius: 999px; background: var(--probara-vis-accent, var(--pv-card));
  color: var(--probara-vis-accent-contrast, var(--pv-fg));
  box-shadow: 0 2px 6px var(--pv-shadow-near), 0 30px 70px -20px var(--pv-shadow-far);
  font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; cursor: pointer; }
button:hover { filter: brightness(1.05); }
button:focus-visible { outline: 2px solid var(--probara-vis-accent, var(--pv-fg)); outline-offset: 3px; }
.mark { display: block; flex: none; width: 20px; height: 11px; }
`;

export function createLauncher(
  doc: Document,
  options: { label: string; position: LauncherPosition; onOpen: () => void },
  mode: ShadowRootMode = 'closed',
): Launcher {
  const host = doc.createElement('div');
  host.setAttribute(LAUNCHER_ATTRIBUTE, '');
  for (const [name, value] of [
    ['position', 'fixed'],
    [options.position === 'bottom-left' ? 'left' : 'right', '16px'],
    ['bottom', '16px'],
    ['z-index', '2147483646'],
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
  const button = doc.createElement('button');
  button.type = 'button';
  button.append(drawMark(doc, 'currentColor'), options.label);
  button.addEventListener('click', () => {
    options.onOpen();
  });
  root.append(button);
  const show = (visible: boolean): void => {
    host.hidden = !visible;
    // A page's own `display` rule may beat `hidden`: say it with the CSSOM too.
    if (visible) host.style.removeProperty('display');
    else host.style.setProperty('display', 'none', 'important');
  };
  show(false);
  ((doc.body as HTMLElement | null) ?? doc.documentElement).append(host);
  return {
    host,
    root,
    show,
    remove() {
      host.remove();
    },
  };
}
