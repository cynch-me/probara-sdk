/** HTTP transport of reports: auth, idempotency, timeouts and retries. */
import { randomUUID } from 'node:crypto';
import type { ReportRequest, ReportResponse } from './api.js';
import { IDEMPOTENCY_KEY_PATTERN } from './limits.js';
import { redact, silentLogger, type Logger } from './logger.js';
import { VERSION } from './version.js';

export interface ClientOptions {
  /** Such as `https://app.probara.net`. */
  baseUrl: string;
  apiToken: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Timeout of one attempt. Defaults to 30000. */
  timeoutMs?: number;
  /** Retries after the first attempt. Defaults to 4. */
  maxRetries?: number;
  /** Waits between attempts. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Source of the backoff jitter, in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
  /** Clock (epoch ms) an HTTP-date `Retry-After` is read against. Defaults to `Date.now`. */
  now?: () => number;
  /** The adapter, such as `probara-playwright/0.1.0`, first in the User-Agent. */
  clientName?: string;
  logger?: Logger;
}

export interface SubmitReportOptions {
  /** The same key on every attempt of one report, so a retry is replayed, never recorded twice. */
  idempotencyKey: string;
  /** Aborts the report; an abort is never retried. */
  signal?: AbortSignal;
}

export interface ProbaraClient {
  /**
   * Sends one report (`POST /api/v1/projects/{projectId}/reports`), retrying transient failures.
   *
   * @throws ProbaraApiError on an error response or an invalid `201` body.
   * @throws ProbaraNetworkError when every attempt failed to get a response.
   * @throws TypeError on an invalid `idempotencyKey`; the caller's abort reason on an abort.
   */
  submitReport(
    projectId: string,
    body: ReportRequest,
    options: SubmitReportOptions,
  ): Promise<ReportResponse>;
}

export interface ProbaraApiErrorInit {
  status: number;
  /** The API error code, `http_<status>` without an error body, `invalid_response` on a bad 201. */
  code: string;
  details?: unknown;
  /** Whether the failure was transient (the retries ran out). */
  retryable: boolean;
  /** The response was replayed from the idempotency store (`Idempotency-Replayed: true`). */
  replayed?: boolean;
}

/** Probara answered with an error, or with a body that is not a report response. */
export class ProbaraApiError extends Error {
  override readonly name = 'ProbaraApiError';
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly retryable: boolean;
  declare readonly replayed?: boolean;

  constructor(message: string, init: ProbaraApiErrorInit) {
    super(message);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.retryable = init.retryable;
    if (init.replayed !== undefined) this.replayed = init.replayed;
  }
}

/** No response from Probara: the connection failed or every attempt timed out. */
export class ProbaraNetworkError extends Error {
  override readonly name = 'ProbaraNetworkError';
}

/** A fresh `Idempotency-Key` for one report. */
export function createIdempotencyKey(): string {
  return randomUUID();
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 120_000;
const JITTER = 0.2;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const HEADER_SAFE_TOKEN = /^[\x21-\x7E]+$/;

type Attempt =
  { kind: 'response'; response: Response } | { kind: 'network'; error: unknown; timedOut: boolean };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableStatus(response: Response): boolean {
  if (RETRYABLE_STATUSES.has(response.status)) return true;
  // An in-flight duplicate of the same idempotency key.
  return response.status === 409 && response.headers.has('retry-after');
}

/** The `Retry-After` delay in ms (seconds or an HTTP date), capped; `undefined` when absent. */
function retryAfterMs(response: Response, now: number): number | undefined {
  const value = response.headers.get('retry-after')?.trim();
  if (value === undefined || value === '') return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(0, ms), MAX_RETRY_AFTER_MS);
}

function isReportResponse(value: unknown): value is ReportResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { run, results, summary } = value as Record<string, unknown>;
  return (
    typeof run === 'object' &&
    run !== null &&
    typeof (run as Record<string, unknown>).ulid === 'string' &&
    Array.isArray(results) &&
    typeof summary === 'object' &&
    summary !== null
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The `{ error: { code, message, details } }` body of an error response, when it has one. */
function errorBodyOf(
  value: unknown,
): { code: string; message: string | undefined; details: unknown } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { error } = value as Record<string, unknown>;
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, message, details } = error as Record<string, unknown>;
  if (typeof code !== 'string') return undefined;
  return { code, message: typeof message === 'string' ? message : undefined, details };
}

/** Creates a client of the Probara report API. */
export function createClient(options: ClientOptions): ProbaraClient {
  const { apiToken } = options;
  if (!HEADER_SAFE_TOKEN.test(apiToken)) {
    throw new TypeError('apiToken must be visible ASCII characters without spaces');
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? silentLogger;
  const clientName = options.clientName?.replace(/[^\x20-\x7E]/g, '').trim() ?? '';
  const userAgent = `${clientName === '' ? '' : `${clientName} `}probara-core/${VERSION} node/${process.versions.node}`;
  const clean = (text: string) => redact(text, [apiToken]);

  function backoffMs(retry: number): number {
    const base = Math.min(BASE_DELAY_MS * 2 ** retry, MAX_BACKOFF_MS);
    return Math.round(base * (1 + JITTER * random()));
  }

  async function attempt(
    url: string,
    init: RequestInit,
    callerSignal: AbortSignal | undefined,
  ): Promise<Attempt> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout]);
    try {
      return { kind: 'response', response: await fetchImpl(url, { ...init, signal }) };
    } catch (error) {
      if (callerSignal?.aborted === true) throw callerSignal.reason;
      return { kind: 'network', error, timedOut: timeout.aborted };
    }
  }

  async function toApiError(response: Response, retryable: boolean): Promise<ProbaraApiError> {
    const parsed = errorBodyOf(parseJson(await response.text().catch(() => '')));
    const code = parsed?.code ?? `http_${response.status}`;
    const detail = parsed?.message === undefined ? '' : `: ${parsed.message}`;
    return new ProbaraApiError(clean(`Probara answered ${response.status} ${code}${detail}`), {
      status: response.status,
      code,
      details: parsed?.details,
      retryable,
      ...(response.headers.get('idempotency-replayed') === 'true' ? { replayed: true } : {}),
    });
  }

  async function toReportResponse(response: Response): Promise<ReportResponse> {
    const parsed = parseJson(await response.text().catch(() => ''));
    if (isReportResponse(parsed)) return parsed;
    throw new ProbaraApiError(
      `Probara answered ${response.status} with a body that is not a report response`,
      { status: response.status, code: 'invalid_response', retryable: false },
    );
  }

  return {
    async submitReport(projectId, body, { idempotencyKey, signal }) {
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new TypeError('idempotencyKey must be 1 to 255 visible ASCII characters');
      }
      const url = `${baseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/reports`;
      const init: RequestInit = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': userAgent,
        },
        body: JSON.stringify(body),
      };
      const attempts = maxRetries + 1;

      for (let number = 1; ; number += 1) {
        signal?.throwIfAborted();
        logger.debug(`Sending report ${idempotencyKey} (attempt ${number} of ${attempts})`);
        const outcome = await attempt(url, init, signal);
        const last = number >= attempts;

        if (outcome.kind === 'response') {
          const { response } = outcome;
          if (response.ok) return toReportResponse(response);
          const retryable = isRetryableStatus(response);
          if (!retryable || last) throw await toApiError(response, retryable);
          const delay = retryAfterMs(response, now()) ?? backoffMs(number - 1);
          await response.body?.cancel().catch(() => undefined);
          logger.warn(
            clean(
              `Report attempt ${number} of ${attempts} got ${response.status}; retrying in ${delay} ms`,
            ),
          );
          await sleep(delay);
          continue;
        }

        const reason = outcome.timedOut
          ? `timed out after ${timeoutMs} ms`
          : `failed: ${errorMessage(outcome.error)}`;
        if (last) {
          throw new ProbaraNetworkError(
            clean(`Could not send the report after ${attempts} attempts: the last one ${reason}`),
            { cause: outcome.error },
          );
        }
        const delay = backoffMs(number - 1);
        logger.warn(
          clean(`Report attempt ${number} of ${attempts} ${reason}; retrying in ${delay} ms`),
        );
        await sleep(delay);
      }
    },
  };
}
