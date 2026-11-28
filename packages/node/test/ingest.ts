/**
 * A fake Probara ingest for the tests: a real HTTP server that keeps the envelopes it gets and
 * answers as the test says.
 */
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ProbaraEvent } from '@probara/error-core';

export interface Received {
  url: string;
  headers: IncomingHttpHeaders;
  header: Record<string, unknown>;
  items: { header: Record<string, unknown>; payload: Buffer }[];
}

function decode(body: Buffer): Pick<Received, 'header' | 'items'> {
  const lineAt = (offset: number) => {
    const end = body.indexOf(10, offset);
    return end === -1
      ? { line: body.subarray(offset), next: body.length }
      : { line: body.subarray(offset, end), next: end + 1 };
  };
  const first = lineAt(0);
  const header = JSON.parse(first.line.toString('utf8')) as Record<string, unknown>;
  const items: Received['items'] = [];
  let offset = first.next;
  while (offset < body.length) {
    const head = lineAt(offset);
    const itemHeader = JSON.parse(head.line.toString('utf8')) as Record<string, unknown>;
    const length = itemHeader['length'] as number;
    items.push({ header: itemHeader, payload: body.subarray(head.next, head.next + length) });
    offset = head.next + length + 1;
  }
  return { header, items };
}

export interface Answer {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Never answers: the request hangs until the server closes. */
  hang?: boolean;
}

export interface FakeIngest {
  dsn: string;
  origin: string;
  received: Received[];
  events(): ProbaraEvent[];
  answer(next: (received: Received) => Answer): void;
  close(): Promise<void>;
}

export async function startIngest(): Promise<FakeIngest> {
  const received: Received[] = [];
  let respond: (received: Received) => Answer = () => ({
    status: 200,
    body: { id: 'x', replay: 'skip' },
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry: Received = {
        url: request.url ?? '',
        headers: request.headers,
        ...decode(Buffer.concat(chunks)),
      };
      received.push(entry);
      const answer = respond(entry);
      if (answer.hang === true) return;
      response.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
      response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    dsn: `http://pek_test@127.0.0.1:${String(port)}/`,
    origin,
    received,
    events: () =>
      received
        .filter((entry) => entry.items[0]?.header['type'] === 'event')
        .map(
          (entry) => JSON.parse(entry.items[0]?.payload.toString('utf8') ?? '{}') as ProbaraEvent,
        ),
    answer(next) {
      respond = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A plain HTTP server answering every request with `status`, for outgoing request tests. */
export async function startUpstream(): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const status = Number(
      new URL(request.url ?? '/', 'http://x').searchParams.get('status') ?? 200,
    );
    response.writeHead(status);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
