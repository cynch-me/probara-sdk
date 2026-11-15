/**
 * Network capture in a real Chromium page. Each test captures the network of its own same-origin
 * frame. Requests go to the test server (which answers 404 to unknown paths, with resource
 * timing), to blob URLs, or to a stand-in `fetch` where a test needs a response body the server
 * cannot send.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NetworkEntry } from './entries.js';
import { createNetworkCapture, type NetworkCaptureOptions } from './network.js';
import { SANITIZER_REDACTED } from './sanitize.js';
import { createRecordingSession, type RecordingSession } from './session.js';

type FrameWindow = Window & typeof globalThis;

const frames: HTMLIFrameElement[] = [];
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
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

let unique = 0;

/**
 * A URL of the test server that does not exist: it answers 404. Its suffix holds letters, so the
 * built-in redaction never takes it for a card number.
 */
function missing(path: string): string {
  unique += 1;
  return `${location.origin}/probara-${path}-n${String(unique)}x${Math.random().toString(36).slice(2, 8)}`;
}

function blobUrl(content: BlobPart, type: string): string {
  return URL.createObjectURL(new Blob([content], { type }));
}

function setUp(options: Omit<NetworkCaptureOptions, 'target'> = {}, win = newFrame()) {
  const session = createRecordingSession();
  session.start();
  const capture = createNetworkCapture(session, { ...options, target: win });
  capture.start();
  stops.push(() => {
    capture.stop();
  });
  return { win, session, capture };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

async function entriesOf(session: RecordingSession, count: number): Promise<NetworkEntry[]> {
  await until(() => session.entries('network').length >= count);
  return session.entries('network') as NetworkEntry[];
}

const ownProperty = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

/** A property as a value, read without binding it. */
const read = (value: object, key: string): unknown => Reflect.get(value, key);

describe('fetch capture', () => {
  it('records a request with its status, headers, duration and resource timing', async () => {
    const { win, session } = setUp();
    const url = missing('get');
    const response = await win.fetch(url, { headers: { 'x-tenant': 'acme' } });
    expect(response.status).toBe(404);
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      kind: 'fetch',
      method: 'GET',
      url,
      status: 404,
      requestHeaders: { 'x-tenant': 'acme' },
      requestBody: null,
      error: null,
      graphql: null,
    });
    expect(entry?.id).toMatch(/^req-/);
    expect(entry?.t).toBeGreaterThanOrEqual(0);
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof entry?.timing?.ttfbMs).toBe('number');
    expect(typeof entry?.timing?.responseMs).toBe('number');
  });

  it('records the request body and redacts credentials before keeping them', async () => {
    const { win, session } = setUp();
    await win.fetch(missing('post'), {
      method: 'post',
      headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
      body: '{"user":"ana","password":"hunter2"}',
    });
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      method: 'POST',
      requestHeaders: { authorization: 'PROBARA_REDACTED', 'content-type': 'application/json' },
      requestBody: {
        text: '{"user":"ana","password":"PROBARA_REDACTED"}',
        truncated: false,
        size: 35,
        omitted: null,
      },
    });
  });

  it('redacts form fields with bracketed names in FormData, URLSearchParams and text bodies', async () => {
    const { win, session } = setUp();
    const form = new win.FormData();
    form.append('user[password]', 'fdPWcore1');
    form.append('user[name]', 'ana');
    await win.fetch(missing('form'), { method: 'POST', body: form });
    await win.fetch(missing('params'), {
      method: 'POST',
      body: new win.URLSearchParams('user[password]=bracketPWcore1&user[api_key]=bracketKEYcore2'),
    });
    await win.fetch(missing('text'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'user%5Bpassword%5D=railsPWcore1',
    });
    const entries = await entriesOf(session, 3);
    expect(entries.map((entry) => entry.requestBody?.text).sort()).toEqual([
      'user%5Bpassword%5D=PROBARA_REDACTED',
      'user%5Bpassword%5D=PROBARA_REDACTED&user%5Bapi_key%5D=PROBARA_REDACTED',
      'user%5Bpassword%5D=PROBARA_REDACTED&user%5Bname%5D=ana',
    ]);
    expect(JSON.stringify(entries)).not.toMatch(
      /fdPWcore1|bracketPWcore1|bracketKEYcore2|railsPWcore1/,
    );
  });

  it('reads the response through a clone: the page gets the whole body, unchanged', async () => {
    const { win, session } = setUp({ maxBodyBytes: 8 });
    const body = '{"items":[1,2,3],"total":3}';
    const response = await win.fetch(blobUrl(body, 'application/json'));
    expect(await response.text()).toBe(body);
    const [entry] = await entriesOf(session, 1);
    expect(entry?.responseBody).toEqual({
      text: '{"items"',
      truncated: true,
      size: body.length,
      omitted: null,
    });
    expect(entry?.responseHeaders).toMatchObject({ 'content-type': 'application/json' });
  });

  it('reads the body of a Request object from a clone, so it is still sent', async () => {
    const { win, session } = setUp();
    const request = new win.Request(missing('request'), { method: 'PUT', body: 'qty=2' });
    const response = await win.fetch(request);
    expect(response.status).toBe(404);
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({ method: 'PUT', requestBody: { text: 'qty=2', size: 5 } });
  });

  it('omits binary bodies and never waits for a body that does not end', async () => {
    const win = newFrame();
    const encoder = new TextEncoder();
    let pull = 0;
    win.fetch = () =>
      Promise.resolve(
        new win.Response(
          new win.ReadableStream({
            pull(controller) {
              pull += 1;
              if (pull === 1) controller.enqueue(encoder.encode('data: 1\n\n'));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const { session } = setUp({ bodyReadTimeoutMs: 50 }, win);
    const events = await win.fetch('https://shop.test/events');
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: 1\n\n');
    await reader.cancel();
    const [entry] = await entriesOf(session, 1);
    expect(entry?.responseBody).toEqual({
      text: null,
      truncated: false,
      size: null,
      omitted: 'stream',
    });
  });

  it('writes the stream in the order requests started, whatever order they end in', async () => {
    const win = newFrame();
    const answers = new Map<string, () => void>();
    win.fetch = ((input: string) =>
      new Promise<Response>((resolve) => {
        answers.set(input, () => {
          resolve(new win.Response('ok'));
        });
      })) as typeof fetch;
    const { session } = setUp({}, win);
    const slow = win.fetch('https://shop.test/slow');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const fast = win.fetch('https://shop.test/fast');
    answers.get('https://shop.test/fast')?.();
    await fast;
    await entriesOf(session, 1);
    answers.get('https://shop.test/slow')?.();
    await slow;
    const entries = await entriesOf(session, 2);
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://shop.test/slow',
      'https://shop.test/fast',
    ]);
    expect(entries[0]?.t).toBeLessThan(entries[1]?.t ?? 0);
  });

  it('omits a binary response with its size', async () => {
    const { win, session } = setUp();
    await win.fetch(blobUrl(new Uint8Array(12), 'image/png'));
    const [entry] = await entriesOf(session, 1);
    expect(entry?.responseBody).toEqual({
      text: null,
      truncated: false,
      size: 12,
      omitted: 'binary',
    });
  });

  it('records a failed request and rejects the page with the same error', async () => {
    const { win, session } = setUp();
    const failure = await win.fetch('http://127.0.0.1:9/').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(win.TypeError);
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      status: null,
      responseBody: null,
      error: `TypeError: ${(failure as Error).message}`,
    });
  });

  it('records an aborted request', async () => {
    const { win, session } = setUp();
    const controller = new win.AbortController();
    const pending = win.fetch(missing('abort'), { signal: controller.signal });
    controller.abort();
    const failure = await pending.catch((error: unknown) => error);
    expect((failure as Error).name).toBe('AbortError');
    const [entry] = await entriesOf(session, 1);
    expect(entry?.error).toMatch(/^AbortError: /);
    expect(entry?.status).toBeNull();
  });

  it('detects the GraphQL operation and the errors of a 200 response', async () => {
    const win = newFrame();
    win.fetch = () =>
      Promise.resolve(
        new win.Response('{"data":null,"errors":[{"message":"Cart not found"}]}', {
          headers: { 'content-type': 'application/json' },
        }),
      );
    const { session } = setUp({}, win);
    await win.fetch('https://shop.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query Cart($id: ID!) { cart(id: $id) { id } }' }),
    });
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      status: 200,
      graphql: { operationName: 'Cart', operationType: 'query', hasErrors: true },
    });
  });

  it('applies the request and response sanitizers, and fails closed when one throws', async () => {
    const { win, session } = setUp({
      requestSanitizer: (request) => ({
        ...request,
        headers: { ...request.headers, 'x-user': '<id>' },
      }),
      responseSanitizer: () => {
        throw new Error('bug in the customer sanitizer');
      },
    });
    const response = await win.fetch(blobUrl('{"name":"Ana"}', 'application/json'), {
      headers: { 'x-user': 'ana' },
    });
    expect(await response.json()).toEqual({ name: 'Ana' });
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      requestHeaders: { 'x-user': '<id>' },
      responseHeaders: {},
      responseBody: { text: SANITIZER_REDACTED },
    });
  });

  it('ignores the URLs it is told to ignore', async () => {
    const ignored = `${location.origin}/probara-upload`;
    const { win, session } = setUp({ ignoreUrls: [ignored, /\/probara-skip-/] });
    await win.fetch(`${ignored}/part/1`);
    await win.fetch(missing('skip'));
    await win.fetch(missing('kept'));
    const entries = await entriesOf(session, 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(session.entries('network').map((entry) => (entry as NetworkEntry).url)).toEqual([
      entries[0]?.url,
    ]);
    expect(entries[0]?.url).toContain('/probara-kept-');
  });

  it('records nothing while the session is not recording', async () => {
    const { win, session } = setUp();
    session.stop();
    const response = await win.fetch(missing('idle'));
    expect(response.status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(session.entries('network')).toEqual([]);
  });
});

describe('XMLHttpRequest capture', () => {
  function send(
    win: FrameWindow,
    method: string,
    url: string,
    setup: (xhr: XMLHttpRequest) => void = () => undefined,
    body: XMLHttpRequestBodyInit | null = null,
  ): Promise<XMLHttpRequest> {
    const xhr = new win.XMLHttpRequest();
    xhr.open(method, url);
    setup(xhr);
    const done = new Promise<XMLHttpRequest>((resolve) => {
      xhr.addEventListener('loadend', () => {
        resolve(xhr);
      });
    });
    xhr.send(body);
    return done;
  }

  it('records a request with its headers, bodies, status and timing', async () => {
    const { win, session } = setUp();
    const url = missing('xhr');
    const xhr = await send(
      win,
      'POST',
      url,
      (request) => {
        request.setRequestHeader('Content-Type', 'application/json');
        request.setRequestHeader('X-Api-Key', 'k-1');
      },
      '{"qty":2}',
    );
    expect(xhr.status).toBe(404);
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      kind: 'xhr',
      method: 'POST',
      url,
      status: 404,
      requestHeaders: { 'content-type': 'application/json', 'x-api-key': 'PROBARA_REDACTED' },
      requestBody: { text: '{"qty":2}', size: 9 },
      error: null,
    });
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof entry?.timing?.ttfbMs).toBe('number');
  });

  it('keeps the response text the page reads, and records it', async () => {
    const { win, session } = setUp({ maxBodyBytes: 4 });
    const xhr = await send(win, 'GET', blobUrl('hello world', 'text/plain'));
    expect(xhr.responseText).toBe('hello world');
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      status: 200,
      responseHeaders: { 'content-type': 'text/plain' },
      responseBody: { text: 'hell', truncated: true, size: 11, omitted: null },
    });
  });

  it('records json and binary response types', async () => {
    const { win, session } = setUp();
    const json = await send(win, 'GET', blobUrl('{"a":1}', 'application/json'), (xhr) => {
      xhr.responseType = 'json';
    });
    expect(json.response).toEqual({ a: 1 });
    await send(win, 'GET', blobUrl(new Uint8Array(5), 'application/octet-stream'), (xhr) => {
      xhr.responseType = 'arraybuffer';
    });
    const entries = await entriesOf(session, 2);
    expect(entries.map((entry) => entry.responseBody)).toEqual([
      { text: '{"a":1}', truncated: false, size: 7, omitted: null },
      { text: null, truncated: false, size: 5, omitted: 'binary' },
    ]);
  });

  it('records a network error and an abort', async () => {
    const { win, session } = setUp();
    await send(win, 'GET', 'http://127.0.0.1:9/');
    const xhr = new win.XMLHttpRequest();
    xhr.open('GET', missing('xhr-abort'));
    xhr.send();
    xhr.abort();
    const entries = await entriesOf(session, 2);
    expect(entries.map(({ status, error }) => ({ status, error }))).toEqual([
      { status: null, error: 'Network error' },
      { status: null, error: 'Aborted' },
    ]);
  });
});

describe('sendBeacon capture', () => {
  it('records the beacon and returns what the browser returned', async () => {
    const { win, session } = setUp();
    const url = missing('beacon');
    expect(win.navigator.sendBeacon(url, '{"event":"pay","token":"t-1"}')).toBe(true);
    const [entry] = await entriesOf(session, 1);
    expect(entry).toMatchObject({
      kind: 'beacon',
      method: 'POST',
      url,
      status: null,
      requestHeaders: { 'content-type': 'text/plain;charset=UTF-8' },
      requestBody: { text: '{"event":"pay","token":"PROBARA_REDACTED"}' },
      responseBody: null,
      error: null,
    });
  });
});

describe('resource capture', () => {
  it('records resources the page loads, without bodies, and not the requests captured above', async () => {
    const { win, session } = setUp();
    const url = missing('image');
    const image = win.document.createElement('img');
    const loaded = new Promise((resolve) => {
      image.addEventListener('error', resolve);
    });
    image.src = url;
    win.document.body.append(image);
    await loaded;
    await win.fetch(missing('fetched'));
    const entries = await entriesOf(session, 2);
    await new Promise((r) => setTimeout(r, 50));
    const kinds = session.entries('network').map((entry) => (entry as NetworkEntry).kind);
    expect(kinds.sort()).toEqual(['fetch', 'resource']);
    const resource = entries.find((entry) => entry.kind === 'resource');
    expect(resource).toMatchObject({
      method: 'GET',
      url,
      status: 404,
      requestBody: null,
      responseBody: null,
      requestHeaders: {},
      responseHeaders: {},
    });
    expect(resource?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('start and stop', () => {
  it('restores exactly what it replaced', () => {
    const win = newFrame();
    const fetch = read(win, 'fetch');
    const proto = win.XMLHttpRequest.prototype;
    const names = ['open', 'send', 'setRequestHeader'];
    const methods = names.map((name) => read(proto, name));
    const { capture } = setUp({}, win);
    expect(read(win, 'fetch')).not.toBe(fetch);
    expect(ownProperty(win.navigator, 'sendBeacon')).toBe(true);
    capture.stop();
    expect(read(win, 'fetch')).toBe(fetch);
    expect(names.map((name) => read(proto, name))).toEqual(methods);
    expect(ownProperty(win.navigator, 'sendBeacon')).toBe(false);
    expect(capture.active).toBe(false);
  });

  it('leaves in place a wrapper the page installed after it', async () => {
    const { win, session, capture } = setUp();
    const captured = read(win, 'fetch') as typeof fetch;
    const pageWrapper = (...args: Parameters<typeof fetch>) => captured(...args);
    win.fetch = pageWrapper;
    capture.stop();
    expect(read(win, 'fetch')).toBe(pageWrapper);
    // Ours, now inactive, calls straight through.
    expect((await win.fetch(missing('after-stop'))).status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(session.entries('network')).toEqual([]);
  });

  it('does not wrap twice when started twice', () => {
    const { win, capture } = setUp();
    const wrapped = read(win, 'fetch');
    capture.start();
    expect(read(win, 'fetch')).toBe(wrapped);
  });
});
