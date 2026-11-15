/**
 * User event capture in a real Chromium page: what the user does becomes user event entries,
 * and what the user types never does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { createBlurController, type BlurController } from './blur.js';
import type { UserEventEntry } from './entries.js';
import { REDACTED } from './redact.js';
import { createRecordingSession, type RecordingSession } from './session.js';
import {
  createUserEventCapture,
  type UserEventCapture,
  type UserEventCaptureOptions,
} from './user-events.js';

const roots: HTMLElement[] = [];
const captures: UserEventCapture[] = [];
const blurs: BlurController[] = [];
const startUrl = location.href;

afterEach(() => {
  for (const capture of captures.splice(0)) capture.stop();
  for (const blur of blurs.splice(0)) blur.stop();
  for (const root of roots.splice(0)) root.remove();
  history.replaceState(history.state, '', startUrl);
});

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  roots.push(root);
  return root;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`nothing matches ${selector}`);
  return element;
}

function setUp(options: UserEventCaptureOptions = {}): {
  session: RecordingSession;
  capture: UserEventCapture;
  /** The entries, without resizes: the test runner resizes its frame whenever it likes. */
  events: () => readonly UserEventEntry[];
  all: () => readonly UserEventEntry[];
} {
  const session = createRecordingSession();
  const capture = createUserEventCapture(session, {
    inputDebounceMs: 20,
    throttleMs: 40,
    ...options,
  });
  captures.push(capture);
  session.start();
  capture.start();
  return {
    session,
    capture,
    events: () => session.entries('events').filter((entry) => entry.type !== 'resize'),
    all: () => session.entries('events'),
  };
}

/** A history method as a value, read without binding it. */
function methodOf(name: 'pushState' | 'replaceState'): unknown {
  return (history as unknown as Record<string, unknown>)[name];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function click(element: Element, x = 12, y = 34): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
}

function type(input: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  for (const char of text) {
    input.value += char;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function press(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('user event capture: clicks', () => {
  it('records a click with its target, short text, coordinates and the page URL', () => {
    const root = mount('<nav id="menu"><button>  Save   the\n draft  </button></nav>');
    const { events } = setUp();
    click(find(root, 'button'), 10, 20);
    expect(events()).toEqual([
      expect.objectContaining({
        type: 'click',
        target: { selector: '#menu > button', tag: 'button', text: 'Save the draft' },
        // The runner's page URL carries a session id, redacted like any other.
        url: location.href.replace(/sessionId=[^&]+/, `sessionId=${REDACTED}`),
        x: 10,
        y: 20,
      }),
    ]);
    expect(events()[0]?.t).toBeGreaterThanOrEqual(0);
  });

  it('names the clickable element around what was clicked, cuts long text and redacts it', () => {
    const long = 'word '.repeat(40);
    const root = mount(`<a id="go"><span>token=abcdef123456 ${long}</span></a>`);
    const { events } = setUp();
    click(find(root, 'span'));
    const target = events()[0]?.target;
    expect(target?.selector).toBe('#go');
    expect(target?.tag).toBe('a');
    expect(target?.text?.startsWith(`token=${REDACTED}`)).toBe(true);
    expect(target?.text?.length).toBeLessThanOrEqual(80);
  });

  it('never takes the text of an input, nor of a blurred element', () => {
    const root = mount('<input value="typed secret"><p id="card">4111 secret</p>');
    const blur = createBlurController();
    blurs.push(blur);
    blur.blur(find(root, '#card'));
    const { events } = setUp({ blur });
    click(find(root, 'input'));
    click(find(root, '#card'));
    expect(events().map((entry) => entry.target)).toEqual([
      { selector: expect.any(String) as string, tag: 'input' },
      { selector: '#card', tag: 'p' },
    ]);
    expect(JSON.stringify(events())).not.toContain('secret');
  });

  it('leaves blurred and editable descendants out of the text of a clicked element', async () => {
    const root = mount(
      '<button id="menu"><span class="who">jane.blurred@example.com</span> Account</button>' +
        '<a id="profile">Open <b>bold-blurred-secret</b> profile</a>' +
        '<table><tbody><tr role="button" id="row"><td>Invoice 7</td>' +
        '<td class="ssn">td-blurred-secret</td></tr></tbody></table>' +
        '<div id="wrap">Notes: <div contenteditable="true" id="editor"></div></div>' +
        '<div role="button" id="fields">Name <input value="input-secret">' +
        '<textarea>area-secret</textarea><select><option>select-secret</option></select></div>',
    );
    const blur = createBlurController();
    blurs.push(blur);
    blur.blur('.who');
    blur.blur(find(root, 'b'));
    blur.blur('.ssn');
    const { events } = setUp({ blur });
    const editor = find(root, '#editor');
    await userEvent.type(editor, 'typed-editable-secret');
    expect(editor.textContent).toBe('typed-editable-secret');
    click(find(root, '.who'));
    click(find(root, 'b'));
    click(find(root, '#row td'));
    click(find(root, '#wrap'));
    click(find(root, '#fields'));
    const clicks = events().filter((entry) => entry.type === 'click');
    expect(clicks.map((entry) => [entry.target?.selector, entry.target?.text])).toEqual([
      ['#menu', 'Account'],
      ['#profile', 'Open profile'],
      ['#row', 'Invoice 7'],
      ['#wrap', 'Notes:'],
      ['#fields', 'Name'],
    ]);
    expect(JSON.stringify(events())).not.toMatch(/blurred|secret/);
  });
});

describe('user event capture: ignored elements', () => {
  it('records nothing that happens inside an ignored element or its shadow root, and the rest as before', async () => {
    const root = mount(
      '<div id="overlay"><button id="inside">Stop</button></div><button id="outside">Pay</button>',
    );
    const overlay = find(root, '#overlay');
    const host = document.createElement('div');
    root.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<button id="shadow-button">Record</button><input id="title">';
    const { events } = setUp({ ignore: (element) => element === overlay || element === host });

    click(find(overlay, '#inside'));
    click(find(shadow, '#shadow-button'));
    const input = shadow.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    press(find(shadow, '#shadow-button'), { key: 'Enter', composed: true });
    press(find(overlay, '#inside'), { key: 'Escape' });
    click(find(root, '#outside'), 5, 6);
    await sleep(60);

    expect(events()).toEqual([
      expect.objectContaining({
        type: 'click',
        target: { selector: '#outside', tag: 'button', text: 'Pay' },
        x: 5,
        y: 6,
      }),
    ]);
  });

  it('records nothing for an element the ignore check throws on', () => {
    const root = mount('<button id="odd">Odd</button>');
    const { events } = setUp({
      ignore: () => {
        throw new Error('broken check');
      },
    });
    click(find(root, '#odd'));
    expect(events()).toEqual([]);
  });
});

describe('user event capture: failures', () => {
  it('treats an element as blurred when the blur check throws, and the page still gets its click', () => {
    const root = mount('<button id="pay">Pay 4111</button>');
    const button = find(root, '#pay');
    let pageClicks = 0;
    button.addEventListener('click', () => (pageClicks += 1));
    const { events } = setUp({
      blur: {
        isBlurred: () => {
          throw new Error('broken');
        },
      },
    });
    click(button);
    expect(pageClicks).toBe(1);
    expect(events()).toEqual([
      expect.objectContaining({ target: { selector: '#pay', tag: 'button' } }),
    ]);
  });
});

describe('user event capture: input', () => {
  it('records typing as one masked entry per pause, never the characters', async () => {
    const root = mount('<label>Name <input id="name"></label>');
    const { events } = setUp();
    type(find(root, '#name') as HTMLInputElement, 'Ada Lovelace');
    expect(events()).toHaveLength(0);
    await sleep(60);
    expect(events()).toEqual([
      expect.objectContaining({
        type: 'input',
        target: { selector: '#name', tag: 'input' },
        value: '************',
      }),
    ]);
  });

  it('records no value at all for a password field', async () => {
    const root = mount('<input id="pw" type="password">');
    const { events } = setUp();
    type(find(root, '#pw') as HTMLInputElement, 'hunter2');
    await sleep(60);
    expect(events()).toHaveLength(1);
    expect(events()[0]).not.toHaveProperty('value');
    expect(JSON.stringify(events())).not.toContain('hunter2');
  });

  it('records whether a checkbox is checked, and flushes pending typing on stop', () => {
    const root = mount('<input id="agree" type="checkbox"><textarea id="note"></textarea>');
    const { events, capture } = setUp({ inputDebounceMs: 10_000 });
    const box = find(root, '#agree') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    type(find(root, '#note') as HTMLTextAreaElement, 'abc');
    capture.stop();
    expect(events().map((entry) => [entry.target?.selector, entry.value])).toEqual([
      ['#agree', 'checked'],
      ['#note', '***'],
    ]);
  });
});

describe('user event capture: real typing and order', () => {
  it('records one entry per typing burst, none more when the field loses focus', async () => {
    const root = mount(
      '<input id="name"><input id="agree" type="checkbox"><button id="next">Next</button>',
    );
    const { events } = setUp();
    await userEvent.type(find(root, '#name'), 'Ada');
    await sleep(60);
    // Leaving the field fires its `change` event: the typing was already recorded.
    await userEvent.click(find(root, '#agree'));
    await userEvent.click(find(root, '#next'));
    await sleep(60);
    const inputs = events().filter((entry) => entry.type === 'input');
    expect(inputs.map((entry) => [entry.target?.selector, entry.value])).toEqual([
      ['#name', '***'],
      ['#agree', 'checked'],
    ]);
  });

  it('records a change no input announced, once per value', () => {
    const root = mount('<select id="size"><option>S</option><option>XL</option></select>');
    const { events, capture } = setUp();
    const select = find(root, '#size') as HTMLSelectElement;
    select.value = 'XL';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    capture.stop();
    expect(events().map((entry) => [entry.type, entry.target?.selector, entry.value])).toEqual([
      ['input', '#size', '**'],
    ]);
  });

  it('writes the stream in time order: typing comes before the click that follows it', async () => {
    const root = mount('<input id="name"><button id="next">Next</button>');
    const { events } = setUp({ inputDebounceMs: 400 });
    await userEvent.type(find(root, '#name'), 'Ada');
    await sleep(5);
    await userEvent.click(find(root, '#next'));
    await sleep(500);
    const recorded = events();
    expect(recorded.map((entry) => [entry.type, entry.target?.selector])).toEqual([
      ['input', '#name'],
      ['click', '#next'],
    ]);
    const times = recorded.map((entry) => entry.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('user event capture: keys', () => {
  it('records non-character keys and modifier shortcuts, never typed characters', () => {
    const root = mount('<input id="q">');
    const input = find(root, '#q');
    const { events } = setUp();
    press(input, { key: 'a' });
    press(input, { key: 'A', shiftKey: true });
    press(input, { key: 'Shift', shiftKey: true });
    press(input, { key: 'Enter' });
    press(input, { key: 'Escape' });
    press(input, { key: 's', ctrlKey: true });
    press(input, { key: 'k', metaKey: true, shiftKey: true });
    press(input, { key: 'Tab', shiftKey: true });
    expect(events().map((entry) => entry.value)).toEqual([
      'Enter',
      'Escape',
      'Control+s',
      'Meta+Shift+k',
      'Shift+Tab',
    ]);
    expect(events().every((entry) => entry.type === 'keypress')).toBe(true);
  });

  it('records no character typed with AltGr, in a password field neither', () => {
    const root = mount('<input id="pw" type="password"><input id="q">');
    const { events } = setUp();
    for (const field of ['#pw', '#q']) {
      for (const key of ['@', '€', '{', '\\']) {
        press(find(root, field), { key, ctrlKey: true, altKey: true });
      }
    }
    press(find(root, '#pw'), { key: '@', ctrlKey: true, modifierAltGraph: true });
    press(find(root, '#pw'), { key: 's', ctrlKey: true });
    press(find(root, '#q'), { key: 'Delete', ctrlKey: true, altKey: true });
    expect(events().map((entry) => entry.value)).toEqual(['Control+s', 'Control+Alt+Delete']);
  });
});

describe('user event capture: navigation, scroll, resize and visibility', () => {
  it('records pushState, replaceState, popstate and hashchange with the new URL', () => {
    const { events } = setUp();
    history.pushState({ a: 1 }, '', '#first');
    history.replaceState(null, '', '?token=abcdef123456&tab=2');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const urls = events().map((entry) => [entry.type, entry.url]);
    expect(urls).toHaveLength(4);
    expect(urls.every(([type]) => type === 'navigation')).toBe(true);
    expect(urls[0]?.[1]).toMatch(/#first$/);
    expect(urls[1]?.[1]).toMatch(new RegExp(`\\?token=${REDACTED}&tab=2$`));
  });

  it('leaves history calls returning and throwing exactly what they would', () => {
    setUp();
    expect(() => {
      history.pushState(null, '', '#ok');
    }).not.toThrow();
    expect(location.hash).toBe('#ok');
    expect(() => {
      history.pushState(null, '', 'https://other.example/');
    }).toThrow(DOMException);
  });

  it('throttles scroll and resize: the first and the last of a burst', async () => {
    mount('<div style="height: 5000px"></div>');
    const { all: events } = setUp();
    for (let i = 1; i <= 10; i++) {
      window.scrollTo(0, i * 10);
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    }
    await sleep(100);
    const scrolls = events().filter((entry) => entry.type === 'scroll');
    const resizes = events().filter((entry) => entry.type === 'resize');
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]).toMatchObject({ x: 0, y: 100 });
    expect(resizes).toHaveLength(2);
    expect(resizes[0]).toMatchObject({ x: window.innerWidth, y: window.innerHeight });
    window.scrollTo(0, 0);
  });

  it('records the page becoming hidden or visible', () => {
    const { events } = setUp();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(events()).toEqual([
      expect.objectContaining({ type: 'visibility', value: document.visibilityState }),
    ]);
  });
});

describe('user event capture: start and stop', () => {
  it('records nothing after stop and puts back the history methods it replaced', () => {
    const push = history.pushState.bind(history);
    const originalPush = methodOf('pushState');
    const originalReplace = methodOf('replaceState');
    const root = mount('<button>b</button>');
    const { events, capture } = setUp();
    expect(methodOf('pushState')).not.toBe(originalPush);
    capture.start();
    capture.stop();
    expect(methodOf('pushState')).toBe(originalPush);
    expect(methodOf('replaceState')).toBe(originalReplace);
    click(find(root, 'button'));
    push(null, '', '#after');
    expect(events()).toHaveLength(0);
    expect(capture.active).toBe(false);
  });

  it('keeps a history wrapper another script installed after it', () => {
    const { capture } = setUp();
    const ours = methodOf('pushState') as (...args: unknown[]) => void;
    const theirs = function (this: History, ...args: Parameters<History['pushState']>): void {
      ours.apply(this, args);
    };
    history.pushState = theirs;
    capture.stop();
    expect(methodOf('pushState')).toBe(theirs);
    Reflect.deleteProperty(history, 'pushState');
  });

  it('records nothing while the session is not recording', () => {
    const root = mount('<button>b</button>');
    const { events, session } = setUp();
    session.stop();
    click(find(root, 'button'));
    expect(events()).toHaveLength(0);
  });
});
