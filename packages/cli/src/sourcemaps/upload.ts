/**
 * Puts one source map to Probara under its debug ID, gzipped, retrying what may pass: a network
 * failure, a timeout, 408, 429 and 5xx (a `Retry-After` sets the wait). Never throws: the outcome
 * says what happened.
 */
import { gzipSync } from 'node:zlib';
import { redact } from '@probara/core';

/** The largest map Probara accepts. */
export const MAX_SOURCE_MAP_BYTES = 25 * 1024 * 1024;

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRY_AFTER_MS = 120_000;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export interface UploadTarget {
  baseUrl: string;
  apiToken: string;
  projectCode: string;
  release: string;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Logs a retry. */
  warn: (message: string) => void;
}

export type UploadOutcome = { ok: true } | { ok: false; error: string };

/** The wait a `Retry-After` asks for (seconds or an HTTP date), capped; none when absent. */
function retryAfterMs(response: Response, now: number): number | undefined {
  const value = response.headers.get('retry-after')?.trim();
  if (value === undefined || value === '') return undefined;
  const ms = /^\d+(?:\.\d+)?$/.test(value)
    ? Math.round(Number(value) * 1000)
    : Date.parse(value) - now;
  return Number.isNaN(ms) ? undefined : Math.min(Math.max(0, ms), MAX_RETRY_AFTER_MS);
}

async function refusalOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  let code = `http_${response.status}`;
  let detail = '';
  try {
    const { error } = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    if (typeof error?.code === 'string') code = error.code;
    if (typeof error?.message === 'string') detail = `: ${error.message}`;
  } catch {
    // A body that is not JSON leaves the status alone to say what happened.
  }
  return `Probara answered ${response.status} ${code}${detail}`;
}

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
  const attempts = target.maxRetries + 1;
  const clean = (text: string) => redact(text, [target.apiToken]);
  for (let attempt = 1; ; attempt += 1) {
    const last = attempt >= attempts;
    let problem: string;
    let wait: number | undefined;
    try {
      const response = await target.fetch(endpoint, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${target.apiToken}`,
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          Accept: 'application/json',
          'User-Agent': target.userAgent,
        },
        body,
        signal: AbortSignal.timeout(target.timeoutMs),
      });
      if (response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: true };
      }
      if (!RETRYABLE.has(response.status) || last) {
        return { ok: false, error: clean(await refusalOf(response)) };
      }
      wait = retryAfterMs(response, target.now());
      await response.body?.cancel().catch(() => undefined);
      problem = `got ${response.status}`;
    } catch (error) {
      problem =
        error instanceof Error && error.name === 'TimeoutError'
          ? `timed out after ${target.timeoutMs} ms`
          : `failed: ${error instanceof Error ? error.message : String(error)}`;
      if (last) {
        return { ok: false, error: clean(`the last of ${attempts} attempts ${problem}`) };
      }
    }
    const delay = wait ?? Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
    target.warn(
      clean(
        `Upload of ${debugId}, attempt ${attempt} of ${attempts}, ${problem}; retrying in ${delay} ms`,
      ),
    );
    await target.sleep(delay);
  }
}
