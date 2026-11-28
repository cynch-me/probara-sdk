/**
 * WebSocket capture: one network entry of kind `websocket` per socket, recorded when it closes
 * (or when capture stops), and one WebSocket message entry per message in each direction unless
 * bodies are left out (`captureBodies`). The
 * `WebSocket` constructor is replaced by a wrapper that keeps `instanceof`, the static constants,
 * the prototype and subclassing intact; messages and events reach the page unchanged.
 */
import type { EntryTime, NetworkEntry, WebSocketDirection } from './entries.js';
import { DEFAULT_BODY_LIMITS, textBody } from './network-body.js';
import { matchesUrl, replaceProperty, type UrlPattern } from './network.js';
import {
  sanitizeNetworkEntry,
  sanitizeWebSocketEntry,
  type RequestSanitizer,
  type WebSocketSanitizer,
} from './sanitize.js';
import type { RecordingSession } from './session.js';

/** The window whose sockets are captured: `globalThis` unless another is given. */
export type WebSocketCaptureTarget = Pick<Window & typeof globalThis, 'WebSocket' | 'location'>;

export interface WebSocketCaptureOptions {
  webSocketSanitizer?: WebSocketSanitizer;
  /** Runs on the socket's own entry (its URL and protocol headers), as on any request. */
  requestSanitizer?: RequestSanitizer;
  /** The UTF-8 bytes of text kept from one message; 64 KiB by default. */
  maxMessageBytes?: number;
  /** Whether messages, a socket's bodies, are recorded; always unless given. Sockets always are. */
  captureBodies?: () => boolean;
  /** Sockets to these URLs are not recorded, nor their messages. */
  ignoreUrls?: readonly UrlPattern[];
  target?: WebSocketCaptureTarget;
}

export interface WebSocketCapture {
  readonly active: boolean;
  /** Replaces the `WebSocket` constructor and its `send`; sockets opened from now on are recorded. */
  start(): void;
  /** Restores them, and records the sockets still open, without a duration. */
  stop(): void;
}

interface Socket {
  id: string;
  url: string;
  start: EntryTime;
  requestHeaders: Record<string, string>;
  opened: EntryTime | null;
  failed: boolean;
  listeners: [string, (event: Event) => void][];
}

const ID_PREFIX = Math.random().toString(36).slice(2, 8);
let sequence = 0;

/** The `[object X]` tag of a value: it holds across windows, where `instanceof` does not. */
function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1);
}

/** A message as kept: text up to `maxBytes`, binary data described by its size. */
export function messageData(data: unknown, maxBytes: number): string {
  if (typeof data === 'string') {
    const body = textBody(data, maxBytes);
    return body.truncated ? `${body.text ?? ''}… [truncated, ${String(body.size)} bytes]` : data;
  }
  const tag = tagOf(data);
  let size: number | undefined;
  if (tag === 'Blob') size = (data as Blob).size;
  else if (tag === 'ArrayBuffer' || tag === 'SharedArrayBuffer')
    size = (data as ArrayBuffer).byteLength;
  else if (ArrayBuffer.isView(data)) size = data.byteLength;
  return size === undefined ? '[unsupported message]' : `[binary message, ${String(size)} bytes]`;
}

export function createWebSocketCapture(
  session: RecordingSession,
  options: WebSocketCaptureOptions = {},
): WebSocketCapture {
  const target: WebSocketCaptureTarget = options.target ?? globalThis;
  const maxBytes = options.maxMessageBytes ?? DEFAULT_BODY_LIMITS.maxBodyBytes;
  const ignoreUrls = options.ignoreUrls ?? [];
  const captureBodies = options.captureBodies ?? (() => true);
  const sockets = new Map<WebSocket, Socket>();
  const restores: (() => void)[] = [];
  let active = false;

  const capturing = () => active && session.state === 'recording';

  function message(socket: Socket, direction: WebSocketDirection, data: unknown): void {
    try {
      if (session.state !== 'recording' || !captureBodies()) return;
      const kept = sanitizeWebSocketEntry(
        { ...session.stamp(), socketId: socket.id, direction, data: messageData(data, maxBytes) },
        options.webSocketSanitizer,
      );
      if (kept !== null) session.record('network', kept);
    } catch {
      // Capture never breaks the page.
    }
  }

  function finish(
    raw: WebSocket,
    socket: Socket,
    close: { code: number; reason: string } | null,
  ): void {
    sockets.delete(raw);
    try {
      for (const [type, listener] of socket.listeners) raw.removeEventListener(type, listener);
      let error: string | null = null;
      if (socket.failed) {
        error =
          close === null ? 'WebSocket error' : `WebSocket error (close code ${String(close.code)})`;
      } else if (close !== null && close.code !== 1000 && close.code !== 1005) {
        error = `Closed with code ${String(close.code)}${close.reason === '' ? '' : `: ${close.reason}`}`;
      }
      const responseHeaders: Record<string, string> = {};
      if (socket.opened !== null) {
        if (raw.protocol !== '') responseHeaders['sec-websocket-protocol'] = raw.protocol;
        if (typeof raw.extensions === 'string' && raw.extensions !== '') {
          responseHeaders['sec-websocket-extensions'] = raw.extensions;
        }
      }
      const entry: NetworkEntry = {
        ...socket.start,
        id: socket.id,
        kind: 'websocket',
        method: 'GET',
        url: socket.url,
        status: socket.opened === null ? null : 101,
        requestHeaders: socket.requestHeaders,
        responseHeaders,
        requestBody: null,
        responseBody: null,
        durationMs: close === null ? null : Math.max(0, session.stamp().t - socket.start.t),
        timing:
          socket.opened === null
            ? null
            : { connectMs: Math.max(0, socket.opened.t - socket.start.t) },
        error,
        graphql: null,
      };
      const kept = sanitizeNetworkEntry(entry, options);
      if (kept !== null) session.record('network', kept);
    } catch {
      // Capture never breaks the page.
    }
  }

  function track(raw: WebSocket, args: unknown[]): void {
    const url = new URL(String(args[0]), target.location.href).href;
    if (matchesUrl(url, ignoreUrls)) return;
    const protocols = args[1];
    const requested = Array.isArray(protocols)
      ? protocols.map(String).join(', ')
      : typeof protocols === 'string'
        ? protocols
        : undefined;
    sequence += 1;
    const socket: Socket = {
      id: `ws-${ID_PREFIX}-${String(sequence)}`,
      url,
      start: session.stamp(),
      requestHeaders:
        requested === undefined || requested === '' ? {} : { 'sec-websocket-protocol': requested },
      opened: null,
      failed: false,
      listeners: [],
    };
    socket.listeners = [
      [
        'open',
        () => {
          socket.opened = session.stamp();
        },
      ],
      [
        'error',
        () => {
          socket.failed = true;
        },
      ],
      [
        'message',
        (event) => {
          message(socket, 'received', (event as MessageEvent).data);
        },
      ],
      [
        'close',
        (event) => {
          const { code, reason } = event as CloseEvent;
          finish(raw, socket, { code, reason });
        },
      ],
    ];
    for (const [type, listener] of socket.listeners) raw.addEventListener(type, listener);
    sockets.set(raw, socket);
  }

  function wrap(Original: typeof WebSocket): typeof WebSocket {
    const Captured = function WebSocket(this: unknown, ...args: unknown[]) {
      // Called without `new`: the browser's own constructor throws its own TypeError.
      if ((new.target as unknown) === undefined)
        return (Original as unknown as (...a: unknown[]) => unknown).apply(this, args);
      const raw = Reflect.construct(
        Original,
        args,
        (new.target as unknown) === Captured ? Original : new.target,
      ) as WebSocket;
      try {
        if (capturing()) track(raw, args);
      } catch {
        // Capture never breaks the page.
      }
      return raw;
    } as unknown as typeof WebSocket;
    Object.defineProperty(Captured, 'prototype', { value: Original.prototype });
    Object.setPrototypeOf(Captured, Original);
    for (const key of ['name', 'length', 'CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      const descriptor = Object.getOwnPropertyDescriptor(Original, key);
      if (descriptor !== undefined) Object.defineProperty(Captured, key, descriptor);
    }
    return Captured;
  }

  return {
    get active() {
      return active;
    },
    start() {
      if (active) return;
      try {
        const Original = target.WebSocket;
        if (typeof Original === 'function') {
          const send = Reflect.get(Original.prototype, 'send') as (...args: unknown[]) => void;
          restores.push(
            replaceProperty(target, 'WebSocket', wrap(Original)),
            replaceProperty(
              Original.prototype,
              'send',
              function (this: WebSocket, ...args: unknown[]) {
                send.apply(this, args);
                const socket = sockets.get(this);
                if (socket !== undefined) message(socket, 'sent', args[0]);
              },
            ),
          );
        }
      } catch {
        // A frozen or missing WebSocket: nothing to capture.
      }
      active = true;
    },
    stop() {
      if (!active) return;
      active = false;
      for (const restore of restores.splice(0).reverse()) {
        try {
          restore();
        } catch {
          // Never throw into the page.
        }
      }
      for (const [raw, socket] of [...sockets]) finish(raw, socket, null);
    },
  };
}
