/**
 * A minimal Chrome DevTools Protocol client over Node's global `WebSocket` (Node 22): commands with
 * their answers, events, and the flat sessions of `Target.attachToTarget`. It finds the browser's
 * WebSocket from an HTTP endpoint (`/json/version`), as Chrome serves on its debugging port.
 */

/** The browser could not be reached, or refused a command. */
export class CdpError extends Error {
  override readonly name = 'CdpError';
}

/** One CDP event, with the session it belongs to. */
export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface CdpConnection {
  /** Sends a command and resolves its result; rejects with a `CdpError`. */
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  /** Calls `listener` with every event; returns the unsubscribe. */
  onEvent(listener: (event: CdpEvent) => void): () => void;
  /** Resolves once the connection is closed, by either side. */
  readonly closed: Promise<void>;
  close(): void;
}

/** Where `--cdp` leads: a browser (pick a page) or one page's own debugger. */
export interface CdpEndpoint {
  url: string;
  kind: 'browser' | 'page';
}

/** How long one command or the discovery request may take. */
const COMMAND_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
  if (typeof cause?.code === 'string') return cause.code;
  if (typeof cause?.message === 'string') return cause.message;
  return error instanceof Error ? error.message : String(error);
}

/** Whether `text` is a URL `--cdp` accepts: http(s) for a debugging port, ws(s) for a debugger. */
export function isCdpUrl(text: string): boolean {
  try {
    return ['http:', 'https:', 'ws:', 'wss:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

/**
 * The WebSocket `endpoint` leads to: itself for a ws(s) URL, else the browser's, read from
 * `/json/version` of the debugging port.
 *
 * @throws CdpError when the port does not answer as Chrome's does.
 */
export async function resolveEndpoint(endpoint: string): Promise<CdpEndpoint> {
  const url = new URL(endpoint);
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return { url: url.href, kind: url.pathname.startsWith('/devtools/page/') ? 'page' : 'browser' };
  }
  const version = new URL('/json/version', url);
  let body: unknown;
  try {
    const response = await fetch(version, { signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) });
    if (!response.ok) throw new CdpError(`it answered ${String(response.status)}`);
    body = await response.json();
  } catch (error) {
    throw new CdpError(
      `Could not reach the browser at ${endpoint} (${error instanceof CdpError ? error.message : errorText(error)}): start it with --remote-debugging-port`,
    );
  }
  const socket = isRecord(body) ? body.webSocketDebuggerUrl : undefined;
  if (typeof socket !== 'string' || !/^wss?:/.test(socket)) {
    throw new CdpError(
      `${endpoint} is not a Chrome DevTools endpoint: its /json/version names no WebSocket`,
    );
  }
  return { url: socket, kind: 'browser' };
}

/** Opens the WebSocket of `url`. @throws CdpError when it cannot. */
export async function connectCdp(url: string): Promise<CdpConnection> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CdpError(`Could not reach the browser at ${url}: no answer`));
      socket.close();
    }, COMMAND_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new CdpError(`Could not reach the browser at ${url}`));
    });
  });

  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  const listeners = new Set<(event: CdpEvent) => void>();
  let markClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });

  socket.addEventListener('message', (message) => {
    if (typeof message.data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (typeof parsed.id === 'number') {
      const waiting = pending.get(parsed.id);
      if (waiting === undefined) return;
      pending.delete(parsed.id);
      clearTimeout(waiting.timer);
      if (isRecord(parsed.error)) {
        const reason = parsed.error.message;
        waiting.reject(
          new CdpError(typeof reason === 'string' ? reason : 'the browser refused the command'),
        );
      } else {
        waiting.resolve(isRecord(parsed.result) ? parsed.result : {});
      }
      return;
    }
    if (typeof parsed.method !== 'string') return;
    const event: CdpEvent = {
      method: parsed.method,
      params: isRecord(parsed.params) ? parsed.params : {},
      ...(typeof parsed.sessionId === 'string' ? { sessionId: parsed.sessionId } : {}),
    };
    for (const listener of [...listeners]) listener(event);
  });
  socket.addEventListener('close', () => {
    for (const [, waiting] of pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new CdpError('The browser closed the connection'));
    }
    pending.clear();
    markClosed();
  });

  return {
    closed,
    send(method, params = {}, sessionId) {
      if (socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new CdpError('The browser closed the connection'));
      }
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new CdpError(`The browser did not answer ${method}`));
        }, COMMAND_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        socket.send(
          JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
        );
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}
