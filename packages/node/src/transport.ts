/**
 * How envelopes leave the server: `fetch`, the key in the `probara-error-key` header, a
 * `text/plain` body as the browser SDK sends.
 */
import type { TransportResponse } from '@probara/error-core';

const CONTENT_TYPE = 'text/plain;charset=UTF-8';

/** How long one envelope may take to send. */
const SEND_TIMEOUT_MS = 30_000;

export interface TransportOptions {
  url: string;
  headers: Record<string, string>;
}

export interface Transport {
  send(body: Uint8Array<ArrayBuffer>): Promise<TransportResponse>;
}

export type TransportFactory = (options: TransportOptions) => Transport;

export function createNodeTransport(options: TransportOptions, send: typeof fetch): Transport {
  return {
    async send(body) {
      const response = await send(options.url, {
        method: 'POST',
        body,
        headers: { 'content-type': CONTENT_TYPE, ...options.headers },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const json: unknown = await response.json().catch(() => null);
      return {
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        rateLimits: response.headers.get('x-probara-rate-limits'),
        body: json,
      };
    },
  };
}
