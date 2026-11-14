/**
 * User event capture: clicks, typing, navigation, keys, scrolling, resizing and visibility of a
 * page, recorded into a session as user event entries. What the user types never becomes an
 * entry: input values are masked, password fields record no value, and keys record only
 * non-character keys and shortcuts. It never throws into the page, and `stop()` puts back the
 * history methods it replaced.
 */
import type { UserEventEntry, UserEventTarget, UserEventType } from './entries.js';
import { redactString } from './redact.js';
import { cssSelector } from './selector.js';
import type { EntryTime } from './entries.js';
import type { RecordingSession } from './session.js';

/** The window whose user events are captured: `globalThis` unless another is given. */
export interface UserEventCaptureTarget {
  location: { href: string };
  history: History;
  document: Document;
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
  addEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: Event) => void,
    options?: EventListenerOptions,
  ): void;
}

export interface UserEventCaptureOptions {
  target?: UserEventCaptureTarget;
  /** The blur controller of the recording: blurred elements give no text. */
  blur?: { isBlurred(element: Element): boolean };
  /** At most one scroll entry per scrolled element, and one resize entry, per this many ms. */
  throttleMs?: number;
  /** Typing in a field becomes one entry once it pauses this many ms. */
  inputDebounceMs?: number;
}

export interface UserEventCapture {
  readonly active: boolean;
  /** Listens to the page and wraps `pushState` and `replaceState`; does nothing when already active. */
  start(): void;
  /** Records pending typing, stops listening and restores the history methods. */
  stop(): void;
}

export const DEFAULT_USER_EVENT_THROTTLE_MS = 250;
export const DEFAULT_INPUT_DEBOUNCE_MS = 500;
/** The longest target text kept. */
export const MAX_TARGET_TEXT_LENGTH = 80;
/** The longest masked value: one `*` per character, up to this many. */
export const MAX_MASKED_VALUE_LENGTH = 100;

/** What a click is about: the closest clickable element around what was hit. */
const CLICKABLE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="option"]';
/** Elements whose text is what the user typed or chose. */
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'Fn',
  'FnLock',
  'Hyper',
  'Super',
  'Symbol',
  'SymbolLock',
  'NumLock',
  'ScrollLock',
]);
/** Keys that are not a key: IME composition, dead keys, unknown keys. */
const IGNORED_KEYS = new Set(['Dead', 'Process', 'Unidentified', '']);

type HistoryMethod = 'pushState' | 'replaceState';
type Fields = Record<string, unknown>;

const isElement = (value: unknown): value is Element =>
  typeof value === 'object' && value !== null && (value as Node).nodeType === 1;

function mask(length: number): string {
  return '*'.repeat(Math.min(length, MAX_MASKED_VALUE_LENGTH));
}

/** The key or shortcut to record, or `undefined` for a typed character or a modifier alone. */
function keyOf(event: KeyboardEvent): string | undefined {
  const key = event.key;
  if (typeof key !== 'string' || IGNORED_KEYS.has(key) || MODIFIER_KEYS.has(key)) return undefined;
  // One code point: a character the key types.
  const character = /^.$/u.test(key);
  // A character with Shift or Alt alone is typed text (Alt types characters on macOS).
  if (character && !event.ctrlKey && !event.metaKey) return undefined;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Meta');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function createUserEventCapture(
  session: RecordingSession,
  options: UserEventCaptureOptions = {},
): UserEventCapture {
  const target = options.target ?? globalThis;
  const throttleMs = options.throttleMs ?? DEFAULT_USER_EVENT_THROTTLE_MS;
  const debounceMs = options.inputDebounceMs ?? DEFAULT_INPUT_DEBOUNCE_MS;
  const patched = new Map<HistoryMethod, { wrapper: unknown; own: boolean; original: unknown }>();
  /** Typing waiting for its pause, per field. */
  const pendingInput = new Map<
    Element,
    { stamp: EntryTime; timer: ReturnType<typeof setTimeout> }
  >();
  /** Throttled scroll and resize, per scrolled element (`resize` and the document as keys). */
  const throttles = new Map<
    unknown,
    { timer: ReturnType<typeof setTimeout>; trailing: (() => void) | undefined }
  >();
  let active = false;

  function blurred(element: Element): boolean {
    try {
      return options.blur?.isBlurred(element) ?? false;
    } catch {
      return true;
    }
  }

  function describe(element: Element): UserEventTarget {
    const out: UserEventTarget = {
      selector: redactString(cssSelector(element)),
      tag: element.localName,
    };
    if (element.closest(FIELD) === null && !blurred(element)) {
      const text = redactString(element.textContent.replace(/\s+/g, ' ').trim()).slice(
        0,
        MAX_TARGET_TEXT_LENGTH,
      );
      if (text !== '') out.text = text;
    }
    return out;
  }

  function record(
    type: UserEventType,
    build: () => Omit<UserEventEntry, 'type' | 'url' | 't' | 'ts'>,
    stamp?: EntryTime,
  ): void {
    if (session.state !== 'recording') return;
    try {
      const entry: UserEventEntry = {
        ...(stamp ?? session.stamp()),
        type,
        url: redactString(target.location.href),
        ...build(),
      };
      session.record('events', entry);
    } catch {
      // Capture never breaks the page.
    }
  }

  /** Runs `fn` now and at most once more per window, with the latest state, for `key`. */
  function throttle(key: unknown, fn: () => void): void {
    const running = throttles.get(key);
    if (running !== undefined) {
      running.trailing = fn;
      return;
    }
    fn();
    const state = {
      trailing: undefined as (() => void) | undefined,
      timer: setTimeout(function flush() {
        const trailing = state.trailing;
        state.trailing = undefined;
        if (trailing === undefined || !active) {
          throttles.delete(key);
          return;
        }
        trailing();
        state.timer = setTimeout(flush, throttleMs);
      }, throttleMs),
    };
    throttles.set(key, state);
  }

  function recordInput(element: Element, stamp: EntryTime): void {
    record(
      'input',
      () => {
        const fields = element as unknown as Fields;
        const kind = typeof fields['type'] === 'string' ? fields['type'].toLowerCase() : '';
        const entry: Omit<UserEventEntry, 'type' | 'url' | 't' | 'ts'> = {
          target: describe(element),
        };
        if (element.localName === 'input' && kind === 'password') return entry;
        if (element.localName === 'input' && (kind === 'checkbox' || kind === 'radio')) {
          entry.value = fields['checked'] === true ? 'checked' : 'unchecked';
        } else if (typeof fields['value'] === 'string') {
          entry.value = mask(Array.from(fields['value']).length);
        } else {
          entry.value = mask(Array.from(element.textContent).length);
        }
        return entry;
      },
      stamp,
    );
  }

  function flushInput(): void {
    for (const [element, { stamp, timer }] of pendingInput) {
      clearTimeout(timer);
      recordInput(element, stamp);
    }
    pendingInput.clear();
  }

  const onClick = (event: Event): void => {
    try {
      const hit = event.composedPath()[0] ?? event.target;
      if (!isElement(hit)) return;
      const element = hit.closest(CLICKABLE) ?? hit;
      const mouse = event as MouseEvent;
      record('click', () => ({
        target: describe(element),
        x: Math.round(mouse.clientX),
        y: Math.round(mouse.clientY),
      }));
    } catch {
      // Never throw into the page.
    }
  };

  const onInput = (event: Event): void => {
    try {
      const element = event.composedPath()[0] ?? event.target;
      if (!isElement(element) || session.state !== 'recording') return;
      const pending = pendingInput.get(element);
      if (pending !== undefined) clearTimeout(pending.timer);
      const stamp = session.stamp();
      pendingInput.set(element, {
        stamp,
        timer: setTimeout(() => {
          pendingInput.delete(element);
          recordInput(element, stamp);
        }, debounceMs),
      });
    } catch {
      // Never throw into the page.
    }
  };

  const onKeydown = (event: Event): void => {
    try {
      const key = keyOf(event as KeyboardEvent);
      if (key === undefined) return;
      const element = event.composedPath()[0] ?? event.target;
      record('keypress', () =>
        isElement(element) ? { target: describe(element), value: key } : { value: key },
      );
    } catch {
      // Never throw into the page.
    }
  };

  const onScroll = (event: Event): void => {
    try {
      const element = event.target;
      if (isElement(element) && element !== target.document.documentElement) {
        throttle(element, () => {
          record('scroll', () => ({
            target: describe(element),
            x: Math.round(element.scrollLeft),
            y: Math.round(element.scrollTop),
          }));
        });
        return;
      }
      throttle(target.document, () => {
        record('scroll', () => ({ x: Math.round(target.scrollX), y: Math.round(target.scrollY) }));
      });
    } catch {
      // Never throw into the page.
    }
  };

  const onResize = (): void => {
    try {
      throttle('resize', () => {
        record('resize', () => ({
          x: Math.round(target.innerWidth),
          y: Math.round(target.innerHeight),
        }));
      });
    } catch {
      // Never throw into the page.
    }
  };

  const onNavigation = (): void => {
    record('navigation', () => ({}));
  };

  const onVisibility = (): void => {
    record('visibility', () => ({ value: target.document.visibilityState }));
  };

  function wrapHistory(method: HistoryMethod): void {
    const history = target.history as unknown as Record<string, unknown>;
    const original = history[method];
    if (typeof original !== 'function') return;
    const call = original as (...args: unknown[]) => unknown;
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      // The page's own call: whatever it returns or throws is passed on unchanged.
      const result = call.apply(this, args);
      if (active) onNavigation();
      return result;
    };
    const own = Object.prototype.hasOwnProperty.call(history, method);
    history[method] = wrapper;
    patched.set(method, { wrapper, own, original });
  }

  const listeners: [string, (event: Event) => void][] = [
    ['click', onClick],
    ['input', onInput],
    ['change', onInput],
    ['keydown', onKeydown],
    ['scroll', onScroll],
    ['resize', onResize],
    ['popstate', onNavigation],
    ['hashchange', onNavigation],
  ];
  const listenerOptions = { capture: true, passive: true };

  return {
    get active() {
      return active;
    },
    start() {
      if (active) return;
      active = true;
      try {
        for (const [type, listener] of listeners)
          target.addEventListener(type, listener, listenerOptions);
        target.document.addEventListener('visibilitychange', onVisibility, listenerOptions);
        wrapHistory('pushState');
        wrapHistory('replaceState');
      } catch {
        // A window without events or a frozen history: capture what could be set up.
      }
    },
    stop() {
      if (!active) return;
      flushInput();
      active = false;
      try {
        for (const [type, listener] of listeners)
          target.removeEventListener(type, listener, listenerOptions);
        target.document.removeEventListener('visibilitychange', onVisibility, listenerOptions);
        const history = target.history as unknown as Record<string, unknown>;
        for (const [method, { wrapper, own, original }] of patched) {
          // Code that wrapped history after us keeps its wrapper; ours, inactive, calls through.
          if (history[method] !== wrapper) continue;
          if (own) history[method] = original;
          else Reflect.deleteProperty(history, method);
        }
      } catch {
        // Never throw into the page.
      }
      patched.clear();
      for (const { timer } of throttles.values()) clearTimeout(timer);
      throttles.clear();
    },
  };
}
