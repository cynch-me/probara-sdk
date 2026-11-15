/**
 * WebSocket capture in a real Chromium page, on its own same-origin frame. The constructor's
 * identity and a failed connection use the browser's `WebSocket`; message traffic uses a
 * stand-in socket class installed as the frame's `WebSocket`, since the test server has no
 * WebSocket endpoint.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NetworkEntry, WebSocketMessageEntry } from './entries.js';
import { SANITIZER_REDACTED } from './sanitize.js';
import { createRecordingSession } from './session.js';
import { createWebSocketCapture, type WebSocketCaptureOptions } from './websocket.js';

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

interface StandIn extends EventTarget {
  readonly url: string;
  protocol: string;
  sent: unknown[];
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
  receive(data: unknown): void;
}

/** A socket class that opens at once, keeps what is sent and receives on demand. */
function installStandIn(win: FrameWindow): { sockets: StandIn[] } {
  const sockets: StandIn[] = [];
  class StandInSocket extends win.EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    protocol = '';
    sent: unknown[] = [];
    constructor(
      readonly url: string,
      protocols?: string | string[],
    ) {
      super();
      sockets.push(this);
      queueMicrotask(() => {
        this.protocol = Array.isArray(protocols) ? (protocols[0] ?? '') : (protocols ?? '');
        this.dispatchEvent(new win.Event('open'));
      });
    }
    send(data: unknown): void {
      this.sent.push(data);
    }
    close(code = 1000, reason = ''): void {
      this.dispatchEvent(new win.CloseEvent('close', { code, reason, wasClean: code === 1000 }));
    }
    receive(data: unknown): void {
      this.dispatchEvent(new win.MessageEvent('message', { data }));
    }
  }
  win.WebSocket = StandInSocket as unknown as typeof WebSocket;
  return { sockets };
}

function setUp(options: Omit<WebSocketCaptureOptions, 'target'> = {}, win = newFrame()) {
  const session = createRecordingSession();
  session.start();
  const capture = createWebSocketCapture(session, { ...options, target: win });
  capture.start();
  stops.push(() => {
    capture.stop();
  });
  return { win, session, capture };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the WebSocket wrapper', () => {
  it('keeps instanceof, the static constants, the prototype and subclassing intact', () => {
    const win = newFrame();
    const Original = win.WebSocket;
    setUp({}, win);
    expect(win.WebSocket).not.toBe(Original);
    expect(win.WebSocket.prototype).toBe(Original.prototype);
    expect(win.WebSocket.name).toBe('WebSocket');
    expect([
      win.WebSocket.CONNECTING,
      win.WebSocket.OPEN,
      win.WebSocket.CLOSING,
      win.WebSocket.CLOSED,
    ]).toEqual([0, 1, 2, 3]);
    const socket = new win.WebSocket('ws://127.0.0.1:9/');
    expect(socket).toBeInstanceOf(Original);
    expect(socket).toBeInstanceOf(win.WebSocket);
    expect(socket.constructor).toBe(Original);
    class Chat extends win.WebSocket {}
    const chat = new Chat('ws://127.0.0.1:9/');
    expect(chat).toBeInstanceOf(Chat);
    expect(chat).toBeInstanceOf(Original);
    // The browser's own error: the frame's TypeError.
    expect(() => {
      (win.WebSocket as unknown as () => void)();
    }).toThrow(win.TypeError);
    socket.close();
    chat.close();
  });

  it('records a socket that failed, and the page still gets its error and close events', async () => {
    const { win, session } = setUp();
    const socket = new win.WebSocket('ws://127.0.0.1:9/live');
    const seen: string[] = [];
    socket.onerror = () => seen.push('error');
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.onclose = resolve;
    });
    expect((await closed).code).toBe(1006);
    expect(seen).toEqual(['error']);
    await until(() => session.entries('network').length > 0);
    const [entry] = session.entries('network') as NetworkEntry[];
    expect(entry).toMatchObject({
      kind: 'websocket',
      method: 'GET',
      url: 'ws://127.0.0.1:9/live',
      status: null,
      requestBody: null,
      responseBody: null,
      error: 'WebSocket error (close code 1006)',
      graphql: null,
    });
    expect(entry?.id).toMatch(/^ws-/);
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('WebSocket traffic', () => {
  it('records each message in both directions, linked to its socket, and passes it on unchanged', async () => {
    const win = newFrame();
    const { sockets } = installStandIn(win);
    const { session } = setUp({ maxMessageBytes: 20 }, win);
    const socket = new win.WebSocket('wss://shop.test/live', ['chat']);
    const received: unknown[] = [];
    socket.addEventListener('message', (event) => received.push(event.data));
    await tick();
    const binary = new Uint8Array([1, 2, 3]).buffer;
    socket.send('{"room":"7"}');
    socket.send(binary);
    socket.send('a long message to cut');
    const standIn = sockets[0] as StandIn;
    standIn.receive('{"secret":"s-1"}');
    standIn.receive(new win.Blob(['12345']));
    socket.close(1000);
    expect(standIn.sent).toEqual(['{"room":"7"}', binary, 'a long message to cut']);
    expect(standIn.sent[1]).toBe(binary);
    expect(received).toHaveLength(2);
    expect(received[0]).toBe('{"secret":"s-1"}');
    await until(() => session.entries('network').length >= 6);
    const entries = session.entries('network');
    const socketEntry = entries.find((entry) => 'kind' in entry) as NetworkEntry;
    expect(socketEntry).toMatchObject({
      kind: 'websocket',
      url: 'wss://shop.test/live',
      status: 101,
      requestHeaders: { 'sec-websocket-protocol': 'chat' },
      responseHeaders: { 'sec-websocket-protocol': 'chat' },
      error: null,
    });
    expect(typeof socketEntry.timing?.connectMs).toBe('number');
    const messages = entries.filter((entry): entry is WebSocketMessageEntry => 'socketId' in entry);
    expect(
      messages.map(({ socketId, direction, data }) => ({ socketId, direction, data })),
    ).toEqual([
      { socketId: socketEntry.id, direction: 'sent', data: '{"room":"7"}' },
      { socketId: socketEntry.id, direction: 'sent', data: '[binary message, 3 bytes]' },
      {
        socketId: socketEntry.id,
        direction: 'sent',
        data: 'a long message to cu… [truncated, 21 bytes]',
      },
      { socketId: socketEntry.id, direction: 'received', data: '{"secret":"PROBARA_REDACTED"}' },
      { socketId: socketEntry.id, direction: 'received', data: '[binary message, 5 bytes]' },
    ]);
  });

  it('redacts form fields with bracketed names in messages both ways', async () => {
    const win = newFrame();
    const { sockets } = installStandIn(win);
    const { session } = setUp({}, win);
    const socket = new win.WebSocket('wss://shop.test/live');
    await tick();
    socket.send('user[password]=bracketPWcore1&user[api_key]=bracketKEYcore2');
    (sockets[0] as StandIn).receive('user%5Bpassword%5D=railsPWcore1');
    await until(() => session.entries('network').length >= 2);
    expect(
      session.entries('network').map((entry) => (entry as WebSocketMessageEntry).data),
    ).toEqual([
      'user[password]=PROBARA_REDACTED&user[api_key]=PROBARA_REDACTED',
      'user%5Bpassword%5D=PROBARA_REDACTED',
    ]);
  });

  it('applies the WebSocket sanitizer, failing closed when it throws', async () => {
    const win = newFrame();
    const { sockets } = installStandIn(win);
    const { session } = setUp(
      {
        webSocketSanitizer: (message) => {
          if (message.direction === 'received') throw new Error('bug');
          return { ...message, data: message.data.replace('7', '<room>') };
        },
      },
      win,
    );
    const socket = new win.WebSocket('wss://shop.test/live');
    await tick();
    socket.send('room 7');
    (sockets[0] as StandIn).receive('hello');
    await until(() => session.entries('network').length >= 2);
    expect(
      session.entries('network').map((entry) => (entry as WebSocketMessageEntry).data),
    ).toEqual(['room <room>', SANITIZER_REDACTED]);
  });

  it('records a socket closed abnormally with its close code', async () => {
    const win = newFrame();
    const { sockets } = installStandIn(win);
    const { session } = setUp({}, win);
    new win.WebSocket('wss://shop.test/live');
    await tick();
    (sockets[0] as StandIn).close(4001, 'kicked');
    await until(() => session.entries('network').length > 0);
    expect((session.entries('network')[0] as NetworkEntry).error).toBe(
      'Closed with code 4001: kicked',
    );
  });

  it('ignores the URLs it is told to ignore, and records nothing while not recording', async () => {
    const win = newFrame();
    const { sockets } = installStandIn(win);
    const { session } = setUp({ ignoreUrls: ['wss://upload.test/'] }, win);
    const ignored = new win.WebSocket('wss://upload.test/live');
    await tick();
    ignored.send('part');
    ignored.close();
    session.stop();
    const idle = new win.WebSocket('wss://shop.test/live');
    await tick();
    idle.send('x');
    (sockets[1] as StandIn).receive('y');
    idle.close();
    await tick();
    expect(session.entries('network')).toEqual([]);
  });
});

describe('start and stop', () => {
  it('restores the constructor and send, and records the sockets still open', async () => {
    const win = newFrame();
    const { sockets } = installStandIn(win);
    const Original = win.WebSocket;
    const send = Reflect.get(Original.prototype, 'send') as unknown;
    const { session, capture } = setUp({}, win);
    const socket = new win.WebSocket('wss://shop.test/live');
    await tick();
    capture.stop();
    expect(win.WebSocket).toBe(Original);
    expect(Reflect.get(Original.prototype, 'send')).toBe(send);
    socket.send('after stop');
    (sockets[0] as StandIn).receive('after stop');
    await tick();
    expect(session.entries('network')).toHaveLength(1);
    expect(session.entries('network')[0]).toMatchObject({
      kind: 'websocket',
      status: 101,
      durationMs: null,
      error: null,
    });
  });

  it('leaves in place a constructor the page installed after it', () => {
    const { win, capture } = setUp();
    const pageSocket = function PageSocket() {} as unknown as typeof WebSocket;
    win.WebSocket = pageSocket;
    capture.stop();
    expect(win.WebSocket).toBe(pageSocket);
  });
});
