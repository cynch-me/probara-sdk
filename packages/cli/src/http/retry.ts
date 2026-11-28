/**
 * Sends one request to Probara, retrying what may pass: a network failure, a timeout, 408, 429 and
 * 5xx (a `Retry-After` sets the wait). Never throws: the outcome says what happened, without the
 * token.
 */
import { redact } from '@probara/core';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRY_AFTER_MS = 120_000;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryTarget {
  apiToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Logs a retry. */
  warn: (message: string) => void;
}

/** A successful answer, its body unread; or why there is none. */
export type SendOutcome = { ok: true; response: Response } | { ok: false; error: string };

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

/**
 * Sends `init` to `url` with the token, retrying; `what` names the request in the retry warnings,
 * such as "Upload of <debug ID>".
 */
export async function sendWithRetries(
  target: RetryTarget,
  url: string,
  init: { method: string; headers: Record<string, string>; body: NonNullable<RequestInit['body']> },
  what: string,
): Promise<SendOutcome> {
  const attempts = target.maxRetries + 1;
  const clean = (text: string) => redact(text, [target.apiToken]);
  for (let attempt = 1; ; attempt += 1) {
    const last = attempt >= attempts;
    let problem: string;
    let wait: number | undefined;
    try {
      const response = await target.fetch(url, {
        method: init.method,
        headers: { ...init.headers, Authorization: `Bearer ${target.apiToken}` },
        body: init.body,
        signal: AbortSignal.timeout(target.timeoutMs),
      });
      if (response.ok) return { ok: true, response };
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
      clean(`${what}, attempt ${attempt} of ${attempts}, ${problem}; retrying in ${delay} ms`),
    );
    await target.sleep(delay);
  }
}
