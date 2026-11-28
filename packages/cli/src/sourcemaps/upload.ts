/**
 * Puts one source map to Probara under its debug ID, gzipped, with the retries of
 * {@link sendWithRetries}. Never throws: the outcome says what happened.
 */
import { gzipSync } from 'node:zlib';
import { sendWithRetries, type RetryTarget } from '../http/retry.js';

/** The largest map Probara accepts. */
export const MAX_SOURCE_MAP_BYTES = 25 * 1024 * 1024;

export interface UploadTarget extends RetryTarget {
  baseUrl: string;
  projectCode: string;
  release: string;
  userAgent: string;
}

export type UploadOutcome = { ok: true } | { ok: false; error: string };

/** PUTs `map` (its JSON bytes) as the source map `debugId` of the file served at `url`. */
export async function uploadSourceMap(
  target: UploadTarget,
  debugId: string,
  url: string,
  map: Uint8Array,
): Promise<UploadOutcome> {
  if (map.byteLength > MAX_SOURCE_MAP_BYTES) {
    return { ok: false, error: 'the map is over 25 MB, the most Probara accepts' };
  }
  const body = gzipSync(map);
  const query = new URLSearchParams({ release: target.release, url });
  const endpoint = `${target.baseUrl.replace(/\/+$/, '')}/api/v1/projects/${encodeURIComponent(
    target.projectCode,
  )}/error-monitoring/source-maps/${encodeURIComponent(debugId)}?${query.toString()}`;
  const sent = await sendWithRetries(
    target,
    endpoint,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        Accept: 'application/json',
        'User-Agent': target.userAgent,
      },
      body,
    },
    `Upload of ${debugId}`,
  );
  if (!sent.ok) return sent;
  await sent.response.body?.cancel().catch(() => undefined);
  return { ok: true };
}
