/**
 * The browser SDK in a real Chromium page, through its public API: what reaches the ingest for
 * errors the page throws or captures, the breadcrumbs of what led to them, the privacy defaults,
 * and the replay uploaded once per session when the server asks for it, read from the one capture
 * the page shares with Probara Vis.
 */
import {
  ERROR_CAPTURE_LIMITS,
  SHARED_CAPTURE_KEY,
  attachSharedCapture,
  redactString,
  type SharedCapture,
} from '@probara/vis-capture';
import * as replayEntry from '@probara/vis-capture/replay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  VERSION,
  addBreadcrumb,
  captureException,
  captureHttpError,
  captureMessage,
  close,
  flush,
  init,
  setContext,
  setExtra,
  setTag,
  setUser,
  withScope,
  type BrowserOptions,
  type ProbaraEvent,
} from './index.js';

const DSN = 'https://pek_browser@ingest.probara.test/';
const ENDPOINT = 'https://ingest.probara.test/api/v1/public/errors/envelope?key=pek_browser';

interface Envelope {
  header: Record<string, unknown>;
  items: { header: Record<string, unknown>; payload: Uint8Array }[];
}

interface Sent {
  url: string;
  init: RequestInit;
  envelope: Envelope;
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

type Json = Record<string, unknown>;

const payloadOf = (sent: Sent): ProbaraEvent =>
  JSON.parse(new TextDecoder().decode(sent.envelope.items[0]?.payload)) as ProbaraEvent;

const originalFetch = globalThis.fetch;
let sent: Sent[] = [];
let answer: (envelope: Envelope) => { replay: 'requested' | 'skip' } = () => ({ replay: 'skip' });
const others: SharedCapture[] = [];

beforeEach(() => {
  sent = [];
  answer = () => ({ replay: 'skip' });
  globalThis.fetch = (input: RequestInfo | URL, requestInit: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://ingest.probara.test/')) {
      const envelope = decode(requestInit.body as Uint8Array);
      sent.push({ url, init: requestInit, envelope });
      const id = envelope.header['event_id'];
      return Promise.resolve(Response.json({ id, ...answer(envelope) }));
    }
    const status = /\/status\/(\d+)$/.exec(url)?.[1];
    return Promise.resolve(new Response('{}', { status: Number(status ?? 200) }));
  };
});

afterEach(async () => {
  await close();
  for (const other of others.splice(0)) other.release();
  Reflect.deleteProperty(globalThis, SHARED_CAPTURE_KEY);
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
});

function start(options: Partial<BrowserOptions> = {}): void {
  init({ dsn: DSN, release: 'shop@2.0.0', environment: 'staging', ...options });
}

const events = (): ProbaraEvent[] =>
  sent.filter((s) => s.envelope.items[0]?.header['type'] === 'event').map(payloadOf);

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

describe('@probara/browser', () => {
  it('sends a captured error to the DSN endpoint as text/plain, with the page, browser and session', async () => {
    start();
    const id = captureException(new TypeError('cart is undefined'));
    await flush();
    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe(ENDPOINT);
    expect(new Headers(request?.init.headers).get('content-type')).toBe('text/plain;charset=UTF-8');
    expect(request?.init.keepalive).toBe(true);
    const event = payloadOf(request as Sent);
    expect(event).toMatchObject({
      event_id: id,
      platform: 'browser',
      release: 'shop@2.0.0',
      environment: 'staging',
      sdk: { name: 'probara.javascript.browser', version: VERSION },
      request: { url: redactString(location.href) },
    });
    expect(event.exception?.values.at(-1)).toMatchObject({
      type: 'TypeError',
      value: 'cart is undefined',
      mechanism: { type: 'generic', handled: true },
    });
    expect(event.contexts?.['browser']?.['name']).toBe('Chrome');
    expect(event.contexts?.['session']?.['id']).toMatch(/^[0-9a-f]{32}$/);
    expect(event.user).toBeUndefined();
  });

  it('keeps one session id per tab session', async () => {
    start();
    captureMessage('first');
    await close();
    start();
    captureMessage('second');
    await flush();
    const [first, second] = events();
    expect(first?.contexts?.['session']?.['id']).toBe(second?.contexts?.['session']?.['id']);
  });

  it("reports the window's uncaught errors and unhandled rejections as unhandled", async () => {
    start();
    const error = new Error('thrown in a handler');
    window.dispatchEvent(
      new ErrorEvent('error', { error, message: error.message, cancelable: true }),
    );
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new RangeError('rejected'),
        cancelable: true,
      }),
    );
    await flush();
    expect(events().map((event) => event.exception?.values.at(-1)?.mechanism)).toEqual([
      { type: 'onerror', handled: false },
      { type: 'onunhandledrejection', handled: false },
    ]);
  });

  it('never sends console.error or console.warn as events, but as breadcrumbs of the next one', async () => {
    start();
    console.error('payment widget failed');
    console.warn('slow response');
    await flush();
    expect(sent).toEqual([]);
    captureMessage('after the console');
    await flush();
    expect(
      events()[0]?.breadcrumbs?.values.map((crumb) => [crumb.category, crumb.level, crumb.message]),
    ).toEqual([
      ['console', 'error', 'payment widget failed'],
      ['console', 'warning', 'slow response'],
    ]);
  });

  it('keeps an HTTP 5xx as a breadcrumb, and sends it as an event only for the URLs asked for', async () => {
    start({ httpErrors: { targets: [/\/api\/payments\//] } });
    await fetch('/api/cart/status/503');
    await fetch('/api/payments/status/500');
    await fetch('/api/payments/status/404');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flush();
    const [httpEvent, ...rest] = events();
    expect(rest).toEqual([]);
    expect(httpEvent?.exception?.values.at(-1)).toMatchObject({
      value: 'HTTP Client Error with status code: 500',
      mechanism: { type: 'http.client', handled: false },
    });
    expect(httpEvent?.contexts?.['response']).toEqual({ status_code: 500 });
    expect(
      httpEvent?.breadcrumbs?.values.map((crumb) => [
        crumb.category,
        crumb.data?.['status_code'],
        crumb.level,
      ]),
    ).toEqual([
      ['fetch', 503, 'error'],
      ['fetch', 500, 'error'],
    ]);
  });

  it('never sends 400, 401 or 404 as events, whatever the statuses asked for', async () => {
    start({ httpErrors: { targets: [location.origin], statuses: [[400, 599]] } });
    for (const status of [400, 401, 404, 422]) await fetch(`/api/status/${String(status)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flush();
    expect(events().map((event) => event.contexts?.['response']?.['status_code'])).toEqual([422]);
  });

  it('sends a failed request a framework reports as an event, its URL redacted, never 400, 401 or 404', async () => {
    start();
    const url = 'https://api.shop.test/orders?access_token=abc123';
    expect(captureHttpError({ url, method: 'POST', status: 404 }, 'angular.http')).toBe('');
    const id = captureHttpError({ url, method: 'POST', status: 502 }, 'angular.http');
    await flush();
    const [event, ...rest] = events();
    expect(rest).toEqual([]);
    expect(event?.event_id).toBe(id);
    expect(event?.exception?.values.at(-1)).toMatchObject({
      value: 'HTTP Client Error with status code: 502',
      mechanism: { type: 'angular.http', handled: false },
    });
    expect(event?.request).toEqual({ url: redactString(url), method: 'POST' });
    expect(event?.request?.url).not.toContain('abc123');
    expect(event?.contexts?.['response']).toEqual({ status_code: 502 });
  });

  it('adds clicks and navigations as breadcrumbs', async () => {
    start();
    const button = document.createElement('button');
    button.id = 'checkout';
    button.textContent = 'Checkout';
    document.body.append(button);
    try {
      button.click();
      const before = location.href;
      history.pushState({}, '', '#step-2');
      captureMessage('after the click');
      await flush();
      history.replaceState({}, '', before);
    } finally {
      button.remove();
    }
    const crumbs = events()[0]?.breadcrumbs?.values ?? [];
    expect(crumbs.find((crumb) => crumb.category === 'ui.click')?.message).toContain('#checkout');
    expect(String(crumbs.find((crumb) => crumb.category === 'navigation')?.data?.['to'])).toContain(
      '#step-2',
    );
  });

  it('keeps only an opaque user, and adds tags, contexts, extra and manual breadcrumbs', async () => {
    start();
    setUser({
      id: 'u-42',
      username: 'alias',
      email: 'person@example.test',
      ip_address: '10.0.0.1',
    });
    setTag('tenant', 'ucsf');
    setContext('cart', { items: 3 });
    setExtra('attempt', 2);
    addBreadcrumb({ category: 'auth', message: 'signed in' });
    withScope((scope) => {
      scope.setTag('step', 'payment');
      captureMessage('in scope');
    });
    await flush();
    const [event] = events();
    expect(event?.user).toEqual({ id: 'u-42', username: 'alias' });
    expect(event).toMatchObject({
      tags: { tenant: 'ucsf', step: 'payment' },
      contexts: { cart: { items: 3 } },
      extra: { attempt: 2 },
    });
    expect(event?.breadcrumbs?.values.map((crumb) => crumb.message)).toContain('signed in');
  });

  it('redacts secrets from the page URL and messages it sends', async () => {
    const before = location.href;
    history.replaceState({}, '', '?token=abc123secret&page=2');
    try {
      start();
      captureMessage('login failed for password=hunter2');
      await flush();
    } finally {
      history.replaceState({}, '', before);
    }
    const json = JSON.stringify(events()[0]);
    expect(json).not.toContain('abc123secret');
    expect(json).not.toContain('hunter2');
  });

  it('uploads one gzip replay per session, only for events the server asks one for', async () => {
    answer = () => ({ replay: 'requested' });
    start({ replay: { enabled: true } });
    await flush();
    const first = captureException(new Error('first'));
    await flush();
    captureException(new Error('second'));
    await flush();
    const replays = sent.filter((s) => s.envelope.items[0]?.header['type'] === 'replay');
    expect(replays).toHaveLength(1);
    expect(replays[0]?.envelope.header['event_id']).toBe(first);
    const lines = (await gunzip(replays[0]?.envelope.items[0]?.payload ?? new Uint8Array()))
      .trim()
      .split('\n');
    expect((JSON.parse(lines[0] ?? '{}') as Json)['type']).toBe(4);
  });

  it('uploads no replay when the server answers skip, or when the replay is off', async () => {
    start({ replay: { enabled: true } });
    await flush();
    captureException(new Error('skipped'));
    await flush();
    await close();
    answer = () => ({ replay: 'requested' });
    start();
    captureException(new Error('replay off'));
    await flush();
    expect(sent.filter((s) => s.envelope.items[0]?.header['type'] === 'replay')).toEqual([]);
  });

  it('reads the replay and the console from the capture Probara Vis already runs', async () => {
    const marker = { type: 5, data: { tag: 'vis-owned-replay' }, timestamp: Date.now() };
    let recorders = 0;
    const visReplay = {
      ...replayEntry,
      createReplayRecorder: (options: Parameters<typeof replayEntry.createReplayRecorder>[0]) => {
        recorders += 1;
        const recorder = replayEntry.createReplayRecorder(options);
        return {
          ...recorder,
          get coverage() {
            return recorder.coverage;
          },
          get health() {
            return recorder.health;
          },
          events: () => [...recorder.events(), marker],
        };
      },
    };
    others.push(attachSharedCapture({ replay: visReplay }));
    const patched = console.error;
    answer = () => ({ replay: 'requested' });
    start({ replay: { enabled: true } });
    await flush();
    expect(console.error).toBe(patched);
    console.error('seen once');
    captureException(new Error('with the shared replay'));
    await flush();
    expect(recorders).toBe(1);
    const [event] = events();
    expect(
      event?.breadcrumbs?.values.filter((crumb) => crumb.message === 'seen once'),
    ).toHaveLength(1);
    const replay = sent.find((s) => s.envelope.items[0]?.header['type'] === 'replay');
    expect(await gunzip(replay?.envelope.items[0]?.payload ?? new Uint8Array())).toContain(
      'vis-owned-replay',
    );
  });

  it('keeps error-sized buffers without bodies on its own, and grows to Vis limits keeping them when Vis attaches', async () => {
    start({ replay: { enabled: true } });
    await flush();
    const cap = ERROR_CAPTURE_LIMITS.console.maxEntries;
    for (let index = 0; index < cap + 20; index += 1) console.info(`line ${String(index)}`);
    await fetch('https://api.shop.test/orders', { method: 'POST', body: '{"sku":"A-1"}' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const vis = attachSharedCapture({ replay: replayEntry });
    others.push(vis);
    const before = vis.snapshot();
    const lines = before?.console.map((entry) => entry.args[0]) ?? [];
    expect(lines).toHaveLength(cap);
    expect(lines[0]).toBe('line 20');
    const order = before?.network.find((entry) => 'url' in entry && entry.url.endsWith('/orders'));
    expect(order).toMatchObject({ method: 'POST', requestBody: null, responseBody: null });

    for (let index = 0; index < 20; index += 1) console.info(`after ${String(index)}`);
    await fetch('https://api.shop.test/payments', { method: 'POST', body: '{"card":"visa"}' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = vis.snapshot();
    const kept = after?.console.map((entry) => entry.args[0]) ?? [];
    expect(kept).toHaveLength(cap + 20);
    expect(kept[0]).toBe('line 20');
    const payment = after?.network.find(
      (entry) => 'url' in entry && entry.url.endsWith('/payments'),
    );
    expect(payment).toMatchObject({ requestBody: { text: '{"card":"visa"}' } });
  });

  it('sends with sendBeacon once the page is being hidden', async () => {
    const beacons: { url: string; body: Blob }[] = [];
    const original = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (url: string, body: Blob) => {
        beacons.push({ url, body });
        return true;
      },
    });
    try {
      start();
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      captureMessage('while leaving');
      await flush();
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
    } finally {
      if (original === undefined)
        delete (navigator as unknown as Record<string, unknown>)['sendBeacon'];
      else Object.defineProperty(navigator, 'sendBeacon', original);
    }
    expect(sent).toEqual([]);
    expect(beacons.map((beacon) => [beacon.url, beacon.body.type])).toEqual([
      [ENDPOINT, 'text/plain;charset=utf-8'],
    ]);
  });

  it('stays off without throwing for a DSN it cannot read', async () => {
    expect(() => {
      init({ dsn: 'not a dsn' });
    }).not.toThrow();
    captureMessage('nowhere');
    await flush();
    expect(sent).toEqual([]);
  });
});
