/**
 * How envelopes leave the page: `fetch` with `keepalive` and a `text/plain` body, which needs no
 * CORS preflight, and `sendBeacon` once the page is being hidden, when `fetch` may not finish.
 */
import type { TransportResponse } from '@probara/error-core';

/** The largest body sent with `keepalive`: browsers refuse more than 64 KiB in flight. */
const KEEPALIVE_MAX_BYTES = 60_000;

const CONTENT_TYPE = 'text/plain;charset=UTF-8';

export interface TransportOptions {
  url: string;
  headers: Record<string, string>;
}

export interface Transport {
  send(body: Uint8Array<ArrayBuffer>): Promise<TransportResponse>;
}

export type TransportFactory = (options: TransportOptions) => Transport;

export interface BrowserTransport extends Transport {
  /** Stops listening to the page. */
  close(): void;
}

export function createBrowserTransport(endpoint: string): BrowserTransport {
  let leaving = false;
  const onHide = (): void => {
    leaving = true;
  };
  const onShow = (): void => {
    leaving = false;
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);

  return {
    async send(body) {
      if (leaving && typeof navigator.sendBeacon === 'function') {
        const queued = navigator.sendBeacon(endpoint, new Blob([body], { type: CONTENT_TYPE }));
        if (!queued) throw new Error('sendBeacon refused the envelope');
        return { status: 202 };
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'content-type': CONTENT_TYPE },
        credentials: 'omit',
        keepalive: body.length <= KEEPALIVE_MAX_BYTES,
      });
      const json: unknown = await response.json().catch(() => null);
      return {
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        rateLimits: response.headers.get('x-probara-rate-limits'),
        body: json,
      };
    },
    close() {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    },
  };
}
