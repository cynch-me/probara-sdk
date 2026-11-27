import { SHARED_CAPTURE_KEY } from '@probara/vis-capture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Probara from './index.js';

const DSN = 'https://pek_browser@ingest.probara.test/';
const ENDPOINT = 'https://ingest.probara.test/api/v1/public/errors/envelope?key=pek_browser';

interface Envelope {
  header: Record<string, unknown>;
  items: { header: Record<string, unknown>; payload: Uint8Array }[];
}

function decode(body: Uint8Array): Envelope {
  const text = new TextDecoder();
  const lineAt = (offset: number) => {
    const end = body.indexOf(10, offset);
    return end === -1
      ? { line: body.subarray(offset), next: body.length }
      : { line: body.subarray(offset, end), next: end + 1 };
  };
  const first = lineAt(0);
  const items: Envelope['items'] = [];
  let offset = first.next;
  while (offset < body.length) {
    const head = lineAt(offset);
    const header = JSON.parse(text.decode(head.line)) as Record<string, unknown>;
    const length = header['length'] as number;
    items.push({ header, payload: body.subarray(head.next, head.next + length) });
    offset = head.next + length + 1;
  }
  return { header: JSON.parse(text.decode(first.line)) as Record<string, unknown>, items };
}

const json = (payload: Uint8Array | undefined): unknown =>
  JSON.parse(new TextDecoder().decode(payload));

interface Sent {
  url: string;
  envelope: Envelope;
}

const originalFetch = globalThis.fetch;
let sent: Sent[] = [];
let respond: (sent: Sent) => Response | 'network-error' = () => Response.json({ replay: 'skip' });

beforeEach(() => {
  sent = [];
  respond = () => Response.json({ replay: 'skip' });
  globalThis.fetch = (input: RequestInfo | URL, requestInit: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const entry = { url, envelope: decode(requestInit.body as Uint8Array) };
    sent.push(entry);
    const answer = respond(entry);
    return answer === 'network-error'
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve(answer);
  };
});

afterEach(async () => {
  await Probara.close();
  Reflect.deleteProperty(globalThis, SHARED_CAPTURE_KEY);
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('probara-errors');
    request.onsuccess =
      request.onerror =
      request.onblocked =
        () => {
          resolve();
        };
  });
});

const typed = (type: string) =>
  sent.filter((entry) => entry.envelope.items.some((item) => item.header['type'] === type));
const events = (): Probara.ProbaraEvent[] =>
  typed('event').map((entry) => json(entry.envelope.items[0]?.payload) as Probara.ProbaraEvent);

function start(options: Partial<Probara.BrowserOptions> = {}): void {
  Probara.init({ dsn: DSN, ...options });
}

function swallowUncaught(): () => void {
  const swallow = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener('error', swallow, { capture: true });
  return () => {
    window.removeEventListener('error', swallow, { capture: true });
  };
}

describe('the options of @probara/browser', () => {
  it('takes the release the bundler plugins inject when the release option is not given', async () => {
    const page = globalThis as { PROBARA_RELEASE?: { id: string } };
    page.PROBARA_RELEASE = { id: 'shop@injected' };
    try {
      start();
      Probara.captureMessage('injected');
      await Probara.flush();
      start({ release: 'shop@given' });
      Probara.captureMessage('given');
      await Probara.flush();
    } finally {
      delete page.PROBARA_RELEASE;
    }
    expect(events().map((event) => event.release)).toEqual(['shop@injected', 'shop@given']);
  });

  it('stays off with enabled: false', async () => {
    start({ enabled: false });
    expect(Probara.captureMessage('nothing')).toBe('');
    await Probara.flush();
    expect(sent).toEqual([]);
  });

  it('posts to the tunnel with the DSN in the envelope header, and sets dist', async () => {
    start({ tunnel: '/probara-tunnel', dist: 'web-1' });
    Probara.captureMessage('tunneled');
    await Probara.flush();
    expect(sent.map((entry) => entry.url)).toEqual(['/probara-tunnel']);
    expect(sent[0]?.envelope.header['dsn']).toBe(DSN);
    expect(events()[0]?.dist).toBe('web-1');
  });

  it('sends through a custom transport, given the URL', async () => {
    const calls: { url: string; length: number }[] = [];
    start({
      transport: ({ url }) => ({
        send: (body) => {
          calls.push({ url, length: body.length });
          return Promise.resolve({ status: 200 });
        },
      }),
    });
    Probara.captureMessage('custom');
    await Probara.flush();
    expect(sent).toEqual([]);
    expect(calls).toEqual([{ url: ENDPOINT, length: expect.any(Number) as number }]);
  });

  it('sends the email of the user only with sendDefaultPii, and applies normalizeDepth and maxValueLength', async () => {
    start({ sendDefaultPii: true, normalizeDepth: 1, maxValueLength: 4 });
    Probara.setUser({ id: 'u-1', email: 'a@b.test' });
    Probara.setExtra('nested', { a: { b: 1 } });
    Probara.captureMessage('truncated');
    await Probara.flush();
    expect(events()[0]).toMatchObject({
      user: { id: 'u-1', email: 'a@b.test' },
      extra: { nested: '[Object]' },
      message: 'trun...',
    });
  });

  it('attaches the stack of the call to messages with attachStacktrace', async () => {
    start({ attachStacktrace: true });
    function checkout(): void {
      Probara.captureMessage('with stack');
    }
    checkout();
    await Probara.flush();
    const frames = events()[0]?.exception?.values[0]?.stacktrace?.frames ?? [];
    expect(frames.at(-1)?.function).toContain('checkout');
  });

  it('logs what it drops to the console with debug, never as breadcrumbs', async () => {
    const warn = vi.spyOn(console, 'warn');
    try {
      start({ debug: true, sampleRate: 0 });
      Probara.captureMessage('sampled out');
      await Probara.flush();
      expect(warn.mock.calls.flat().join(' ')).toContain('[probara]');
    } finally {
      warn.mockRestore();
    }
    start();
    Probara.captureMessage('next');
    await Probara.flush();
    const crumbs = events()[0]?.breadcrumbs?.values ?? [];
    expect(crumbs.filter((crumb) => crumb.message?.includes('[probara]') === true)).toEqual([]);
  });
});

describe('the top-level API of @probara/browser', () => {
  it('sets extras, level and fingerprint, and hands out the last event id and the scopes', async () => {
    expect(Probara.lastEventId()).toBeUndefined();
    start();
    Probara.setExtras({ cart: 2, step: 'pay' });
    Probara.setLevel('warning');
    Probara.setFingerprint(['checkout']);
    Probara.getIsolationScope().setTag('page', 'cart');
    Probara.withScope(() => {
      Probara.getCurrentScope().setTag('inner', 'yes');
      expect(Probara.getCurrentScope()).not.toBe(Probara.getIsolationScope());
      Probara.captureMessage('inside');
    });
    const id = Probara.captureMessage('outside');
    expect(Probara.lastEventId()).toBe(id);
    await Probara.flush();
    expect(
      events().map((event) => [event.level, event.fingerprint, event.extra, event.tags]),
    ).toEqual([
      ['warning', ['checkout'], { cart: 2, step: 'pay' }, { page: 'cart', inner: 'yes' }],
      ['warning', ['checkout'], { cart: 2, step: 'pay' }, { page: 'cart' }],
    ]);
  });
});

describe('the instrumentation of @probara/browser', () => {
  it('captures errors thrown in setTimeout, requestAnimationFrame and event listener callbacks once, with mechanism instrument', async () => {
    const restore = swallowUncaught();
    try {
      start();
      const timeout = new Error('in a timeout');
      const frame = new Error('in a frame');
      const listened = new Error('in a listener');
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          setTimeout(resolve, 0);
          throw timeout;
        }, 0);
      });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 0);
          throw frame;
        });
      });
      const button = document.createElement('button');
      document.body.append(button);
      const onClick = (): void => {
        throw listened;
      };
      button.addEventListener('click', onClick);
      button.click();
      button.removeEventListener('click', onClick);
      button.click();
      button.remove();
      await Probara.flush();
    } finally {
      restore();
    }
    expect(
      events().map((event) => [
        event.exception?.values.at(-1)?.value,
        event.exception?.values.at(-1)?.mechanism,
      ]),
    ).toEqual([
      ['in a timeout', { type: 'instrument', handled: false, data: { function: 'setTimeout' } }],
      [
        'in a frame',
        { type: 'instrument', handled: false, data: { function: 'requestAnimationFrame' } },
      ],
      [
        'in a listener',
        {
          type: 'instrument',
          handled: false,
          data: { function: 'addEventListener', handler: 'onClick' },
        },
      ],
    ]);
  });

  it('leaves callbacks alone with browserApiErrors: false', async () => {
    const restore = swallowUncaught();
    try {
      start({ browserApiErrors: false });
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          setTimeout(resolve, 0);
          throw new Error('not wrapped');
        }, 0);
      });
      await Probara.flush();
    } finally {
      restore();
    }
    expect(events()).toEqual([]);
  });

  it('sends console calls of the levels asked for as message events with captureConsole', async () => {
    start({ captureConsole: { levels: ['warn', 'error'] } });
    console.warn('low stock', 3);
    console.info('not captured');
    await Probara.flush();
    expect(events()).toMatchObject([
      {
        message: 'low stock 3',
        level: 'warning',
        logger: 'console',
        extra: { arguments: ['low stock', '3'] },
      },
    ]);
  });

  it('sends the reports of the ReportingObserver as messages when asked to', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'ReportingObserver');
    let deliver: ((reports: unknown[]) => void) | undefined;
    let types: unknown;
    Object.defineProperty(window, 'ReportingObserver', {
      configurable: true,
      value: class {
        constructor(handler: (reports: unknown[]) => void, options: { types?: unknown }) {
          deliver = handler;
          types = options.types;
        }
        observe(): void {}
        disconnect(): void {}
      },
    });
    try {
      start({ reportingObserver: { types: ['deprecation'] } });
      deliver?.([
        {
          type: 'deprecation',
          url: 'https://shop.test/',
          body: { id: 'x', message: 'Synchronous XHR is deprecated' },
        },
      ]);
      await Probara.flush();
    } finally {
      if (original === undefined) Reflect.deleteProperty(window, 'ReportingObserver');
      else Object.defineProperty(window, 'ReportingObserver', original);
    }
    expect(types).toEqual(['deprecation']);
    expect(events()).toMatchObject([
      {
        message: 'ReportingObserver [deprecation]: Synchronous XHR is deprecated',
        extra: { url: 'https://shop.test/', body: { message: 'Synchronous XHR is deprecated' } },
      },
    ]);
  });
});

describe('the transport of @probara/browser', () => {
  it('reads X-Probara-Rate-Limits and stops sending the limited categories', async () => {
    respond = () =>
      Response.json(
        { replay: 'skip' },
        { headers: { 'x-probara-rate-limits': '60:error:key:quota_exceeded' } },
      );
    start();
    Probara.captureMessage('first');
    await Probara.flush();
    Probara.captureMessage('limited');
    await Probara.flush();
    expect(events().map((event) => event.message)).toEqual(['first']);
  });

  it('keeps envelopes that fail to send in IndexedDB, and sends them when the browser is back online', async () => {
    respond = () => 'network-error';
    start();
    Probara.captureMessage('offline');
    await Probara.flush();
    respond = () => Response.json({ replay: 'skip' });
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(
      () => {
        expect(events().map((event) => event.message)).toEqual(['offline', 'offline']);
      },
      { timeout: 200 },
    );
  });

  it('sends the envelopes kept in IndexedDB on the next init', async () => {
    respond = () => 'network-error';
    start();
    Probara.captureMessage('from the last page');
    await Probara.flush();
    await Probara.close();
    respond = () => Response.json({ replay: 'skip' });
    start();
    await vi.waitFor(
      () => {
        expect(events().map((event) => event.message)).toEqual([
          'from the last page',
          'from the last page',
        ]);
      },
      { timeout: 200 },
    );
  });

  it('sends a client report of what it dropped when the page is hidden', async () => {
    start({ sampleRate: 0 });
    Probara.captureMessage('sampled out');
    const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await Probara.flush();
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
    expect(visibility).toBeDefined();
    const report = typed('client_report')[0]?.envelope.items[0];
    expect(report?.header['type']).toBe('client_report');
    expect(json(report?.payload)).toMatchObject({
      discarded_events: [{ reason: 'sample_rate', category: 'error', quantity: 1 }],
    });
  });
});
