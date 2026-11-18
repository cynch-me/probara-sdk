/**
 * The optional floating launcher of in-app reporting: one button in a shadow root, as the panel
 * is, built with DOM calls only. Its colours follow the page through the CSS custom properties
 * `--probara-vis-accent` (background) and `--probara-vis-accent-contrast` (text), with neutral
 * defaults.
 */

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
:host { all: initial; }
button { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border: 0;
  border-radius: 999px; background: var(--probara-vis-accent, #1b1d21);
  color: var(--probara-vis-accent-contrast, #ffffff); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  font: 600 14px/1.2 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; cursor: pointer; }
button:hover { filter: brightness(1.1); }
button:focus-visible { outline: 3px solid var(--probara-vis-accent, #1b1d21); outline-offset: 3px; }
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
  button.textContent = options.label;
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
