/**
 * A Probara that answers slowly, for what a real one does and a CI runner looks like: the adapter
 * sends its results over HTTP and nothing on its side waits for the answer, so a round trip of a
 * few hundred milliseconds is enough to lose the last results of a run (the Cypress reporter
 * process is killed ~50 ms after the last spec).
 *
 * The proxy stands in front of the fake Probara of a test and forwards every request to it after a
 * delay, so a test can drive that boundary for real instead of assuming how fast it is.
 */
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { Buffer } from 'node:buffer';

/** The Probara of a test behind a delay, and the way to stop it. */
export interface SlowProbara {
  /** The `PROBARA_BASE_URL` a test reports to, like the fake's own. */
  readonly baseUrl: string;
  /** Stops answering, and drops what is still in flight. */
  close(): Promise<void>;
}

/** How long the delay of a proxy is, and what a test may change about it. */
export interface SlowProbaraOptions {
  /** How long every request waits before the fake is asked. */
  delayMs?: number;
}

/**
 * A Probara that answers `target` (the base URL of a fake) after `delayMs`, on a port of its own.
 * Resolves once it is listening: a test that reports to it and waits for the results is waiting for
 * a real HTTP round trip, whatever the machine it runs on.
 */
export async function startSlowProbara(
  target: string,
  { delayMs = 0 }: SlowProbaraOptions = {},
): Promise<SlowProbara> {
  const url = new URL(target);
  const delay = Math.max(delayMs, 0);
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const answer = (): void => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(incoming.headers)) {
          // What belongs to this hop is not forwarded: the next one is its own connection.
          if (name === 'host' || name === 'connection' || name === 'keep-alive') continue;
          if (value !== undefined) headers[name] = value;
        }
        if (body.length > 0) headers['content-length'] = String(body.length);
        const forwarded = httpRequest(
          {
            host: url.hostname,
            port: url.port === '' ? 80 : Number(url.port),
            path: incoming.url ?? '/',
            method: incoming.method ?? 'GET',
            headers,
          },
          (response) => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          },
        );
        forwarded.on('error', () => {
          if (!outgoing.headersSent) outgoing.writeHead(502);
          outgoing.end();
        });
        forwarded.end(body);
      };
      if (delay === 0) answer();
      else setTimeout(answer, delay).unref();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
