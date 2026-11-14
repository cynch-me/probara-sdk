/**
 * Blur: elements marked while recording render blurred in the page, so a screen recording shows
 * them blurred; the replay blocks them and user events never take their text. Elements are marked
 * one by one or by a CSS selector, which also covers elements added later. Everything is applied
 * through the CSSOM (an inline style property and a constructed stylesheet), which a Content
 * Security Policy does not block, and `stop()` puts the page back as it was.
 */

/** The attribute on an element blurred by reference. */
export const BLUR_ATTRIBUTE = 'data-probara-blur';

/** How strong the blur is, in CSS pixels. */
export const DEFAULT_BLUR_RADIUS_PX = 12;

export interface BlurControllerOptions {
  /** The document whose elements are blurred: `document` unless another is given. */
  document?: Document;
  radiusPx?: number;
}

export interface BlurController {
  /**
   * One CSS selector matching everything blurred: the attribute, then each selector given to
   * `blur`, in order. The replay blocks what it matches.
   */
  readonly selector: string;
  /** Blurs an element, or every element a CSS selector matches; throws a `TypeError` for a selector that is not valid CSS. */
  blur(target: Element | string): void;
  /** Takes the blur off an element blurred by reference, or off a selector. */
  unblur(target: Element | string): void;
  /** `element` is blurred, or sits inside a blurred element. */
  isBlurred(element: Element): boolean;
  /** Calls `listener` after each change of what is blurred; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Unblurs everything and removes what the controller added to the page. */
  stop(): void;
}

interface Marked {
  /** The inline `filter` the element had, with its priority, to put back. */
  value: string;
  priority: string;
}

export function createBlurController(options: BlurControllerOptions = {}): BlurController {
  const doc = options.document ?? document;
  const filter = `blur(${String(options.radiusPx ?? DEFAULT_BLUR_RADIUS_PX)}px)`;
  const marked = new Map<HTMLElement | SVGElement, Marked>();
  const selectors: string[] = [];
  const listeners = new Set<() => void>();
  let sheet: CSSStyleSheet | undefined;

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A listener never stops the others.
      }
    }
  }

  function validate(selector: string): void {
    try {
      doc.createDocumentFragment().querySelector(selector);
    } catch {
      throw new TypeError(`not a valid CSS selector: ${selector}`);
    }
  }

  function applySheet(): void {
    const view = doc.defaultView;
    if (view === null) return;
    if (sheet === undefined) {
      sheet = new view.CSSStyleSheet();
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(selectors.map((s) => `${s} { filter: ${filter} !important; }`).join('\n'));
  }

  function removeSheet(): void {
    if (sheet === undefined) return;
    const ours = sheet;
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== ours);
    sheet = undefined;
  }

  function restore(element: HTMLElement | SVGElement, previous: Marked): void {
    element.removeAttribute(BLUR_ATTRIBUTE);
    if (previous.value === '') element.style.removeProperty('filter');
    else element.style.setProperty('filter', previous.value, previous.priority);
  }

  /** An element with an inline style; checked by shape, so elements of another frame pass. */
  const styled = (element: Element): element is HTMLElement | SVGElement =>
    typeof (element as Partial<HTMLElement>).style?.setProperty === 'function';

  const combined = (): string => [`[${BLUR_ATTRIBUTE}]`, ...selectors].join(', ');

  return {
    get selector() {
      return combined();
    },
    blur(target) {
      if (typeof target === 'string') {
        validate(target);
        if (selectors.includes(target)) return;
        selectors.push(target);
        applySheet();
      } else {
        if (!styled(target) || marked.has(target)) return;
        marked.set(target, {
          value: target.style.getPropertyValue('filter'),
          priority: target.style.getPropertyPriority('filter'),
        });
        target.setAttribute(BLUR_ATTRIBUTE, '');
        target.style.setProperty('filter', filter, 'important');
      }
      notify();
    },
    unblur(target) {
      if (typeof target === 'string') {
        const index = selectors.indexOf(target);
        if (index === -1) return;
        selectors.splice(index, 1);
        if (selectors.length === 0) removeSheet();
        else applySheet();
      } else {
        if (!styled(target)) return;
        const previous = marked.get(target);
        if (previous === undefined) return;
        marked.delete(target);
        restore(target, previous);
      }
      notify();
    },
    isBlurred(element) {
      try {
        return element.closest(combined()) !== null;
      } catch {
        // Fail closed: what cannot be checked is treated as blurred.
        return true;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      const changed = marked.size > 0 || selectors.length > 0;
      for (const [element, previous] of marked) restore(element, previous);
      marked.clear();
      selectors.length = 0;
      removeSheet();
      if (changed) notify();
    },
  };
}
