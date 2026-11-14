/**
 * Console capture in a real Chromium page. Each test captures the console of its own same-origin
 * frame, so the errors it throws on purpose reach that frame's `window` and never the test
 * runner's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONSOLE_LEVELS,
  createConsoleCapture,
  createRecordingSession,
  MAX_CONSOLE_SOURCE_LENGTH,
  MAX_CONSOLE_STACK_LENGTH,
  SANITIZER_REDACTED,
  type ConsoleCaptureOptions,
} from './index.js';

type FrameWindow = Window & typeof globalThis;

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

function newFrame(): FrameWindow {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const win = frame.contentWindow;
  if (win === null) throw new Error('the frame has no window');
  return win as FrameWindow;
}

/** Runs `code` as a classic script of the frame: what it throws is uncaught there. */
function runScript(win: FrameWindow, code: string): void {
  const script = win.document.createElement('script');
  script.textContent = code;
  win.document.body.append(script);
}

/** A console whose methods count their calls, standing in for the browser's. */
function spyConsole(win: FrameWindow): Record<string, unknown[][]> {
  const calls: Record<string, unknown[][]> = {};
  for (const level of CONSOLE_LEVELS) {
    calls[level] = [];
    win.console[level] = (...args: unknown[]) => {
      calls[level]?.push(args);
    };
  }
  return calls;
}

/** A console method as a value, read without binding it. */
function methodOf(console: Console, level: string): unknown {
  return (console as unknown as Record<string, unknown>)[level];
}

function setUp(options: Omit<ConsoleCaptureOptions, 'target'> = {}) {
  const win = newFrame();
  const calls = spyConsole(win);
  const originals: Record<string, unknown> = Object.fromEntries(
    CONSOLE_LEVELS.map((level) => [level, methodOf(win.console, level)]),
  );
  const session = createRecordingSession();
  session.start();
  const capture = createConsoleCapture(session, { ...options, target: win });
  return { win, calls, originals, session, capture };
}

/** Loads `code` as a script file of the frame, from a blob URL, and waits until it ran. */
async function runScriptFile(win: FrameWindow, code: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const script = win.document.createElement('script');
  script.src = url;
  const loaded = new Promise((resolve) => {
    script.addEventListener('load', resolve);
  });
  win.document.body.append(script);
  await loaded;
  return url;
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

describe('console capture', () => {
  it('records every console level with its serialized arguments', () => {
    const { win, session, capture } = setUp();
    capture.start();
    win.console.log('log line', { id: 1 });
    win.console.info('info line');
    win.console.warn('warn line', 3);
    win.console.error('error line', [1, 2]);
    win.console.debug('debug line');
    win.console.trace('trace line');
    expect(session.entries('console').map(({ level, args }) => ({ level, args }))).toEqual([
      { level: 'log', args: ['log line', '{"id":1}'] },
      { level: 'info', args: ['info line'] },
      { level: 'warn', args: ['warn line', '3'] },
      { level: 'error', args: ['error line', '[1,2]'] },
      { level: 'debug', args: ['debug line'] },
      { level: 'trace', args: ['trace line'] },
    ]);
    for (const entry of session.entries('console')) {
      expect(entry.t).toBeGreaterThanOrEqual(0);
      expect(Math.abs(entry.ts - Date.now())).toBeLessThan(5000);
    }
  });

  it('calls the original console exactly once, with the same arguments', () => {
    const { win, calls, capture } = setUp();
    capture.start();
    const cart = { id: 7 };
    win.console.log('cart', cart);
    win.console.error('failed');
    expect(calls['log']).toEqual([['cart', cart]]);
    expect(calls['log']?.[0]?.[1]).toBe(cart);
    expect(calls['error']).toEqual([['failed']]);
  });

  it('records the stack trace from the caller of the console', () => {
    const { win, session, capture } = setUp();
    capture.start();
    win.console.warn('where');
    const stack = session.entries('console')[0]?.stack ?? '';
    const firstFrame = stack.split('\n')[0] ?? '';
    expect(firstFrame).toContain('console.browser.test.ts');
  });

  it('is idempotent when started twice', () => {
    const { win, calls, session, capture, originals } = setUp();
    capture.start();
    capture.start();
    win.console.info('once');
    expect(calls['info']).toHaveLength(1);
    expect(session.entries('console')).toHaveLength(1);
    capture.stop();
    expect(methodOf(win.console, 'info')).toBe(originals['info']);
  });

  it('restores the original console methods on stop and records nothing after', () => {
    const { win, calls, session, capture, originals } = setUp();
    capture.start();
    expect(capture.active).toBe(true);
    expect(methodOf(win.console, 'log')).not.toBe(originals['log']);
    capture.stop();
    expect(capture.active).toBe(false);
    for (const level of CONSOLE_LEVELS) {
      expect(methodOf(win.console, level)).toBe(originals[level]);
    }
    win.console.log('after stop');
    expect(calls['log']).toEqual([['after stop']]);
    expect(session.entries('console')).toEqual([]);
  });

  it('leaves a wrapper installed after its own in place on stop, and stops recording', () => {
    const { win, calls, session, capture } = setUp();
    capture.start();
    const ours = methodOf(win.console, 'log') as (...args: unknown[]) => void;
    const theirs = (...args: unknown[]): void => {
      ours.apply(win.console, args);
    };
    win.console.log = theirs;
    capture.stop();
    expect(methodOf(win.console, 'log')).toBe(theirs);
    win.console.log('through both');
    expect(calls['log']).toEqual([['through both']]);
    expect(session.entries('console')).toEqual([]);
  });

  it('records uncaught errors of the window with their stack and source', async () => {
    const { win, session, capture } = setUp();
    capture.start();
    const url = await runScriptFile(
      win,
      "function pay() {\n  throw new Error('payment declined');\n}\npay();",
    );
    const [entry] = session.entries('console');
    expect(entry?.level).toBe('error');
    expect(entry?.args).toEqual(['Uncaught Error: payment declined']);
    expect(entry?.stack).toContain('at pay');
    expect(entry?.source).toBe(`${url}:2:9`);
  });

  it('records a thrown value that is not an Error', () => {
    const { win, session, capture } = setUp();
    capture.start();
    runScript(win, "throw { code: 'E_CART' };");
    expect(session.entries('console')[0]?.args).toEqual(['Uncaught {"code":"E_CART"}']);
  });

  it('records unhandled promise rejections', async () => {
    const { win, session, capture } = setUp();
    capture.start();
    runScript(win, "Promise.reject(new TypeError('cart missing'));");
    await until(() => session.entries('console').length > 0);
    const [entry] = session.entries('console');
    expect(entry?.level).toBe('error');
    expect(entry?.args[0]).toBe('Uncaught (in promise) TypeError: cart missing');
    expect(entry?.stack).toContain('TypeError: cart missing');
  });

  it('stops listening to the window on stop', async () => {
    const { win, session, capture } = setUp();
    capture.start();
    capture.stop();
    runScript(win, "Promise.reject(new Error('late'));");
    runScript(win, "throw new Error('late too');");
    await new Promise((r) => setTimeout(r, 50));
    expect(session.entries('console')).toEqual([]);
  });

  it('records nothing while its session is not recording, and still calls through', () => {
    const { win, calls, session, capture } = setUp();
    session.stop();
    capture.start();
    win.console.log('not recorded');
    expect(calls['log']).toHaveLength(1);
    expect(session.entries('console')).toEqual([]);
  });

  it('redacts form fields with bracketed names in console lines', () => {
    const { win, session, capture } = setUp();
    capture.start();
    win.console.log('user[password]=bracketPWcore1&user[api_key]=bracketKEYcore2');
    win.console.warn('posted user%5Bpassword%5D=railsPWcore1');
    expect(session.entries('console').map((entry) => entry.args)).toEqual([
      ['user[password]=PROBARA_REDACTED&user[api_key]=PROBARA_REDACTED'],
      ['posted user%5Bpassword%5D=PROBARA_REDACTED'],
    ]);
  });

  it('keeps at most MAX_CONSOLE_STACK_LENGTH characters of a stack and MAX_CONSOLE_SOURCE_LENGTH of a source', () => {
    const { win, session, capture } = setUp();
    capture.start();
    const error = new win.Error('huge');
    error.stack = 'Error: huge\n' + '    at frame (https://shop.test/app.js:1:1)\n'.repeat(25_000);
    win.dispatchEvent(
      new win.ErrorEvent('error', {
        message: 'Uncaught Error: huge',
        error,
        filename: `https://shop.test/${'a'.repeat(1_000_000)}.js`,
        lineno: 1,
        colno: 2,
      }),
    );
    const [entry] = session.entries('console');
    expect(entry?.args).toEqual(['Uncaught Error: huge']);
    expect(entry?.stack?.length).toBe(MAX_CONSOLE_STACK_LENGTH);
    expect(entry?.stack?.startsWith('Error: huge\n    at frame')).toBe(true);
    expect(entry?.stack?.endsWith('…')).toBe(true);
    expect(entry?.source?.length).toBe(MAX_CONSOLE_SOURCE_LENGTH);
    expect(entry?.source?.startsWith('https://shop.test/aaa')).toBe(true);
  });

  it('runs the logSanitizer, then the built-in redaction', () => {
    const { win, session, capture } = setUp({
      logSanitizer: (entry) =>
        entry.args[0] === 'drop me'
          ? null
          : { ...entry, args: entry.args.map((a) => a.toUpperCase()) },
    });
    capture.start();
    win.console.log('drop me');
    win.console.log('token=abc');
    expect(session.entries('console').map((entry) => entry.args)).toEqual([
      ['TOKEN=PROBARA_REDACTED'],
    ]);
  });

  it('never throws into the page: a failing sanitizer fails closed', () => {
    const { win, calls, session, capture } = setUp({
      logSanitizer: () => {
        throw new Error('customer bug');
      },
    });
    capture.start();
    expect(() => {
      win.console.error('secret detail');
    }).not.toThrow();
    expect(calls['error']).toEqual([['secret detail']]);
    expect(session.entries('console').map((entry) => entry.args)).toEqual([[SANITIZER_REDACTED]]);
  });

  it('never throws into the page on arguments that cannot be read', () => {
    const { win, calls, session, capture } = setUp();
    capture.start();
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    expect(() => {
      win.console.log(hostile);
    }).not.toThrow();
    expect(calls['log']).toHaveLength(1);
    expect(session.entries('console')[0]?.args).toEqual(['[Unserializable]']);
  });

  it('does not record the console calls its own sanitizer makes', () => {
    const { win, calls, session, capture } = setUp({
      logSanitizer: (entry) => {
        win.console.log('inside the sanitizer');
        return entry;
      },
    });
    capture.start();
    win.console.log('outer');
    expect(calls['log']).toEqual([['inside the sanitizer'], ['outer']]);
    expect(session.entries('console').map((entry) => entry.args)).toEqual([['outer']]);
  });
});
