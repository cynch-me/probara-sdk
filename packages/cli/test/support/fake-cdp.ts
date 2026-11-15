/**
 * A fake Chrome DevTools Protocol endpoint, in-process on loopback: the HTTP discovery route
 * (`/json/version`) and a WebSocket server written on `node:http` (RFC 6455, text frames only),
 * speaking the few commands `probara vis record` sends. It runs no page: a test scripts what the
 * page sends through the binding once the capture script is injected, and when the page closes.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface FakePageInfo {
  id: string;
  url: string;
  title: string;
  /** `page` unless given: other targets (a service worker) are never recorded. */
  type?: string;
}

/** One command the CLI sent. */
export interface CdpCommand {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

/** A page the capture script was injected into, as a test drives it. */
export interface FakePage {
  readonly info: FakePageInfo;
  /** Calls the binding with `payload` (an object is serialized as JSON, a string sent as is). */
  send(payload: unknown): void;
  /** The tab closes. */
  close(): void;
}

export interface FakeCdpOptions {
  pages: FakePageInfo[];
  /** Runs once the capture script is evaluated in a page. */
  onInject?: (page: FakePage) => void | Promise<void>;
  /** Runs when the CLI stops the capture in a page, before the answer: the page's last flush. */
  onStop?: (page: FakePage) => void;
  /** The capture script throws this when it is evaluated, as a page that breaks it would. */
  injectionError?: string;
}

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.byteLength;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Reads the complete client frames of `buffer`; returns them and what is left. */
function readFrames(buffer: Buffer): { frames: { opcode: number; data: Buffer }[]; rest: Buffer } {
  const frames: { opcode: number; data: Buffer }[] = [];
  let offset = 0;
  for (;;) {
    if (buffer.byteLength - offset < 2) break;
    const first = buffer[offset] ?? 0;
    const second = buffer[offset + 1] ?? 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.byteLength - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.byteLength - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const masked = (second & 0x80) !== 0;
    const maskEnd = cursor + (masked ? 4 : 0);
    if (buffer.byteLength < maskEnd + length) break;
    const data = Buffer.from(buffer.subarray(maskEnd, maskEnd + length));
    if (masked) {
      for (let index = 0; index < data.byteLength; index += 1) {
        data[index] = (data[index] ?? 0) ^ (buffer[cursor + (index % 4)] ?? 0);
      }
    }
    frames.push({ opcode: first & 0x0f, data });
    offset = maskEnd + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export async function startFakeCdp(options: FakeCdpOptions) {
  const pages = new Map(options.pages.map((page) => [page.id, { ...page }]));
  const commands: CdpCommand[] = [];
  const newDocumentScripts: string[] = [];
  const injected: { pageId: string; source: string }[] = [];
  const bindings: string[] = [];
  const sockets = new Set<Socket>();
  let port = 0;

  const server = createServer((request, response) => {
    if (request.url === '/json/version') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          Browser: 'Chrome/140.0.0.0',
          webSocketDebuggerUrl: `ws://127.0.0.1:${String(port)}/devtools/browser/fake`,
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    const key = request.headers['sec-websocket-key'];
    const path = request.url ?? '';
    const directPage = /^\/devtools\/page\/(.+)$/.exec(path)?.[1];
    if (
      typeof key !== 'string' ||
      (directPage === undefined && path !== '/devtools/browser/fake')
    ) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const accept = createHash('sha1')
      .update(key + GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const emit = (message: unknown) => {
      if (!socket.destroyed) socket.write(frame(JSON.stringify(message)));
    };
    /** The page a session (or the direct page connection) is attached to. */
    const sessions = new Map<string | undefined, string>();
    if (directPage !== undefined) sessions.set(undefined, decodeURIComponent(directPage));

    function handleOf(pageId: string, sessionId: string | undefined): FakePage {
      const info = pages.get(pageId) ?? { id: pageId, url: 'about:blank', title: '' };
      const event = (method: string, params: unknown) => {
        emit({ method, params, ...(sessionId === undefined ? {} : { sessionId }) });
      };
      return {
        info,
        send(payload) {
          const name = bindings.at(-1) ?? '';
          event('Runtime.bindingCalled', {
            name,
            payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
            executionContextId: 1,
          });
        },
        close() {
          pages.delete(pageId);
          if (sessionId === undefined) {
            emit({ method: 'Inspector.detached', params: { reason: 'target_closed' } });
            socket.end();
            return;
          }
          emit({ method: 'Target.detachedFromTarget', params: { sessionId, targetId: pageId } });
          emit({ method: 'Target.targetDestroyed', params: { targetId: pageId } });
        },
      };
    }

    function answer(command: {
      id: number;
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }): unknown {
      const { method, params, sessionId } = command;
      switch (method) {
        case 'Target.setDiscoverTargets':
        case 'Runtime.enable':
        case 'Page.enable':
        case 'Runtime.removeBinding':
        case 'Page.removeScriptToEvaluateOnNewDocument':
        case 'Target.detachFromTarget':
          return {};
        case 'Target.getTargets':
          return {
            targetInfos: [...pages.values()].map((page) => ({
              targetId: page.id,
              type: page.type ?? 'page',
              title: page.title,
              url: page.url,
              attached: false,
            })),
          };
        case 'Target.attachToTarget': {
          const targetId = String(params.targetId);
          const id = `SESSION-${targetId}`;
          sessions.set(id, targetId);
          return { sessionId: id };
        }
        case 'Runtime.addBinding':
          bindings.push(String(params.name));
          return {};
        case 'Page.addScriptToEvaluateOnNewDocument':
          newDocumentScripts.push(String(params.source));
          return { identifier: String(newDocumentScripts.length) };
        case 'Runtime.evaluate': {
          const pageId = sessions.get(sessionId);
          const expression = String(params.expression);
          if (pageId !== undefined && newDocumentScripts.includes(expression)) {
            injected.push({ pageId, source: expression });
            if (options.injectionError !== undefined) {
              return {
                result: { type: 'object', subtype: 'error', description: options.injectionError },
                exceptionDetails: {
                  text: 'Uncaught',
                  exception: { description: options.injectionError },
                },
              };
            }
            const page = handleOf(pageId, sessionId);
            setImmediate(() => {
              void options.onInject?.(page);
            });
          } else if (pageId !== undefined && expression.includes('probara.vis.cli')) {
            options.onStop?.(handleOf(pageId, sessionId));
          }
          return { result: { type: 'undefined' } };
        }
        default:
          return undefined;
      }
    }

    let pending: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = readFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const { opcode, data } of frames) {
        if (opcode === 0x8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (opcode !== 0x1) continue;
        const command = JSON.parse(data.toString('utf8')) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
          sessionId?: string;
        };
        const params = command.params ?? {};
        commands.push({
          method: command.method,
          params,
          ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
        });
        const result = answer({ ...command, params });
        const session = command.sessionId === undefined ? {} : { sessionId: command.sessionId };
        emit(
          result === undefined
            ? {
                id: command.id,
                error: { code: -32601, message: `'${command.method}' wasn't found` },
                ...session,
              }
            : { id: command.id, result, ...session },
        );
      }
    });
    socket.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  return {
    httpUrl: `http://127.0.0.1:${String(port)}`,
    browserUrl: `ws://127.0.0.1:${String(port)}/devtools/browser/fake`,
    pageUrl: (id: string) => `ws://127.0.0.1:${String(port)}/devtools/page/${id}`,
    commands: () => [...commands],
    /** The sources the CLI registered for every new document. */
    newDocumentScripts: () => [...newDocumentScripts],
    /** The pages the script was evaluated in. */
    injected: () => [...injected],
    bindings: () => [...bindings],
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

export type FakeCdp = Awaited<ReturnType<typeof startFakeCdp>>;
