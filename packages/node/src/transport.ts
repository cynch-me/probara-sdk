/**
 * How envelopes leave the server: `fetch`, the key in the `probara-error-key` header, a
 * `text/plain` body as the browser SDK sends.
 */
import type { Dsn, TransportResponse } from '@probara/error-core';

const CONTENT_TYPE = 'text/plain;charset=UTF-8';

/** How long one envelope may take to send. */
const SEND_TIMEOUT_MS = 30_000;

export function createNodeTransport(
  dsn: Dsn,
  send: typeof fetch,
): (body: Uint8Array<ArrayBuffer>) => Promise<TransportResponse> {
  return async (body) => {
    const response = await send(dsn.endpoint, {
      method: 'POST',
      body,
      headers: { 'content-type': CONTENT_TYPE, 'probara-error-key': dsn.key },
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const json: unknown = await response.json().catch(() => null);
    return {
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
      body: json,
    };
  };
}
