/**
 * What leaves the server about a request: no credentials, cookies or client IP addresses, and no
 * secrets in query strings.
 */
import type { RequestInfo } from '@probara/error-core';

/** What replaces a secret value. */
export const FILTERED = '[Filtered]';

const SECRET_QUERY_KEY =
  /pass|secret|token|api[-_]?key|auth|session|signature|credential|jwt|^sig$|^code$|^key$/i;

const SECRET_HEADER =
  /authorization|cookie|token|secret|password|api[-_]?key|session|auth|signature|csrf|xsrf/i;

/** Headers that carry the client's IP address. */
const IP_HEADERS = new Set([
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'x-cluster-client-ip',
  'fastly-client-ip',
]);

/** `url` with the values of secret query parameters replaced by `[Filtered]`. */
export function scrubUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.replace(/\?.*$/, '');
  }
  let changed = false;
  for (const key of new Set(parsed.searchParams.keys())) {
    if (!SECRET_QUERY_KEY.test(key)) continue;
    parsed.searchParams.set(key, FILTERED);
    changed = true;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    parsed.username = '';
    parsed.password = '';
    changed = true;
  }
  return changed ? parsed.toString() : url;
}

type HeaderSource = Headers | Record<string, string | string[] | number | undefined>;

/** The headers safe to send: without credentials, cookies or the client's IP address. */
export function scrubHeaders(headers: HeaderSource): Record<string, string> {
  const entries: [string, unknown][] =
    headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (value === undefined || IP_HEADERS.has(name) || SECRET_HEADER.test(name)) continue;
    if (Array.isArray(value)) out[name] = value.join(', ');
    else if (typeof value === 'string' || typeof value === 'number') out[name] = String(value);
  }
  return out;
}

/** The request of an event: its method, its URL and its headers, scrubbed. */
export function requestInfo(method: string, url: string, headers: HeaderSource): RequestInfo {
  return { method: method.toUpperCase(), url: scrubUrl(url), headers: scrubHeaders(headers) };
}
