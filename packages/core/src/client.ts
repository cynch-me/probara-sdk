/** HTTP transport of reports and run closes: auth, idempotency, timeouts and retries. */
import { randomUUID } from 'node:crypto';
import type { CloseRunResponse, ReportRequest, ReportResponse } from './api.js';
import { IDEMPOTENCY_KEY_PATTERN, MAX_IDEMPOTENCY_KEY_LENGTH } from './limits.js';
import { redact, silentLogger, type Logger } from './logger.js';
import { VERSION } from './version.js';

export interface ClientOptions {
  /** Such as `https://app.probara.net`. */
  baseUrl: string;
  apiToken: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Timeout of one attempt, including reading its body: an integer from 1 to 600000. Defaults to 30000. */
  timeoutMs?: number;
  /** Retries after the first attempt: an integer from 0 to 10. Defaults to 4. */
  maxRetries?: number;
  /**
   * Waits between attempts. Gets the caller's signal, if any, and should end the wait early once it
   * aborts (the abort is then thrown). Defaults to a `setTimeout` that the signal cancels.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Source of the backoff jitter, in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
  /** Clock (epoch ms) an HTTP-date `Retry-After` is read against. Defaults to `Date.now`. */
  now?: () => number;
  /** The adapter, such as `probara-playwright/0.1.0`, first in the User-Agent. */
  clientName?: string;
  logger?: Logger;
}

/** Options of one request of {@link ProbaraClient}. */
export interface RequestOptions {
  /** The same key on every attempt of one request, so a retry is replayed, never applied twice. */
  idempotencyKey: string;
  /** Aborts the request, a wait between attempts included; an abort is never retried. */
  signal?: AbortSignal;
}

/** Options of {@link ProbaraClient.submitReport}. */
export type SubmitReportOptions = RequestOptions;

export interface ProbaraClient {
  /**
   * Sends one report (`POST /api/v1/projects/{projectId}/reports`), retrying transient failures.
   *
   * @throws ProbaraApiError on an error response or an invalid `201` body.
   * @throws ProbaraNetworkError when every attempt failed to get a response.
   * @throws TypeError on an invalid `idempotencyKey`; the caller's abort reason on an abort.
   *
   * Error messages, `details` strings and network causes never hold the API token.
   */
  submitReport(
    projectId: string,
    body: ReportRequest,
    options: SubmitReportOptions,
  ): Promise<ReportResponse>;

  /**
   * Closes a run (`POST /api/v1/runs/{runUlid}/close`), retrying transient failures like
   * {@link submitReport}. A run that is already closed or aborted answers 409 `conflict`, an
   * unknown one 404 `not_found`.
   *
   * @throws ProbaraApiError on an error response or an invalid `200` body.
   * @throws ProbaraNetworkError when every attempt failed to get a response.
   * @throws TypeError on an invalid `idempotencyKey`; the caller's abort reason on an abort.
   */
  closeRun(runUlid: string, options: RequestOptions): Promise<CloseRunResponse>;
}

export interface ProbaraApiErrorInit {
  status: number;
  /** The API error code, `http_<status>` without an error body, `invalid_response` on a bad success body. */
  code: string;
  details?: unknown;
  /** Whether the failure was transient (the retries ran out). */
  retryable: boolean;
  /** The response was replayed from the idempotency store (`Idempotency-Replayed: true`). */
  replayed?: boolean;
}

/** Probara answered with an error, or with a success body of the wrong shape. */
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

/**
 * No response from Probara: the connection failed or every attempt timed out. `cause` describes
 * the last failure (name, message, `code` and nested causes) with the API token redacted.
 */
export class ProbaraNetworkError extends Error {
  override readonly name = 'ProbaraNetworkError';
}

/** A fresh `Idempotency-Key` for one request. */
export function createIdempotencyKey(): string {
  return randomUUID();
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
/** The largest `timeoutMs` a client accepts (10 minutes). */
export const MAX_TIMEOUT_MS = 600_000;
/** The most `maxRetries` a client accepts. */
export const MAX_RETRIES = 10;
const MAX_CAUSE_DEPTH = 5;
const BASE_DELAY_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 120_000;
const JITTER = 0.2;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const HEADER_SAFE_TOKEN = /^[\x21-\x7E]+$/;

type Attempt =
  | { kind: 'response'; response: Response; text: string | undefined }
  | { kind: 'network'; error: unknown; timedOut: boolean };

/** Waits `ms`, or less when `signal` aborts first. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
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
  // Delta seconds, a decimal one (`1.5`) included, never reach `Date.parse`.
  const ms = /^\d+(?:\.\d+)?$/.test(value)
    ? Math.round(Number(value) * 1000)
    : Date.parse(value) - now;
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

function isCloseRunResponse(value: unknown): value is CloseRunResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { ulid, displayId, state } = value as Record<string, unknown>;
  return typeof ulid === 'string' && typeof displayId === 'string' && typeof state === 'string';
}

/** One kind of request: how it is named in messages and what its success body must be. */
interface Operation<T> {
  /** Such as `report`, in `Sending report <key>` and `Could not send the report`. */
  readonly name: string;
  /** What a success body is, in the `invalid_response` message. */
  readonly expected: string;
  readonly isResponse: (value: unknown) => value is T;
}

const SUBMIT_REPORT: Operation<ReportResponse> = {
  name: 'report',
  expected: 'a report response',
  isResponse: isReportResponse,
};

const CLOSE_RUN: Operation<CloseRunResponse> = {
  name: 'close request',
  expected: 'a run',
  isResponse: isCloseRunResponse,
};

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
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

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** `value` with `clean` applied to every string in it, arrays and plain objects included. */
function redactStrings(value: unknown, clean: (text: string) => string): unknown {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, clean));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStrings(item, clean)]),
    );
  }
  return value;
}

/** A copy of a failure (name, message, `code`, nested causes) with `clean` applied to its text. */
function redactedCause(error: unknown, clean: (text: string) => string, depth = 0): unknown {
  if (!(error instanceof Error)) return clean(String(error));
  const nested =
    error.cause === undefined || depth >= MAX_CAUSE_DEPTH
      ? {}
      : { cause: redactedCause(error.cause, clean, depth + 1) };
  const copy = new Error(clean(error.message), nested);
  copy.name = clean(error.name);
  const { code } = error as { code?: unknown };
  if (typeof code === 'string' || typeof code === 'number') {
    Object.assign(copy, { code: typeof code === 'string' ? clean(code) : code });
  }
  return copy;
}

/** Creates a client of the Probara report API: reports and run closes. */
export function createClient(options: ClientOptions): ProbaraClient {
  const { apiToken } = options;
  if (typeof apiToken !== 'string' || !HEADER_SAFE_TOKEN.test(apiToken)) {
    throw new TypeError('apiToken must be visible ASCII characters without spaces');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!isIntegerIn(timeoutMs, 1, MAX_TIMEOUT_MS)) {
    throw new TypeError(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!isIntegerIn(maxRetries, 0, MAX_RETRIES)) {
    throw new TypeError(`maxRetries must be an integer from 0 to ${MAX_RETRIES}`);
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch;
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
      const response = await fetchImpl(url, { ...init, signal });
      // A success body is read under the same timeout: a body that fails to arrive is a network
      // failure, retried under the same idempotency key (the server replays what it stored).
      return { kind: 'response', response, text: response.ok ? await response.text() : undefined };
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
      details: redactStrings(parsed?.details, clean),
      retryable,
      ...(response.headers.get('idempotency-replayed') === 'true' ? { replayed: true } : {}),
    });
  }

  function toResponse<T>(operation: Operation<T>, response: Response, text: string): T {
    const parsed = parseJson(text);
    if (operation.isResponse(parsed)) return parsed;
    throw new ProbaraApiError(
      `Probara answered ${response.status} with a body that is not ${operation.expected}`,
      { status: response.status, code: 'invalid_response', retryable: false },
    );
  }

  /** POSTs `body` as JSON to `path`, retrying transient failures under one idempotency key. */
  async function post<T>(
    operation: Operation<T>,
    path: string,
    body: unknown,
    { idempotencyKey, signal }: RequestOptions,
  ): Promise<T> {
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new TypeError(
        `idempotencyKey must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} visible ASCII characters`,
      );
    }
    const url = `${baseUrl}${path}`;
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
    const title = capitalize(operation.name);

    for (let number = 1; ; number += 1) {
      signal?.throwIfAborted();
      logger.debug(
        `Sending ${operation.name} ${idempotencyKey} (attempt ${number} of ${attempts})`,
      );
      const outcome = await attempt(url, init, signal);
      const last = number >= attempts;

      if (outcome.kind === 'response') {
        const { response, text } = outcome;
        if (response.ok) return toResponse(operation, response, text ?? '');
        const retryable = isRetryableStatus(response);
        if (!retryable || last) throw await toApiError(response, retryable);
        const delay = retryAfterMs(response, now()) ?? backoffMs(number - 1);
        await response.body?.cancel().catch(() => undefined);
        logger.warn(
          clean(
            `${title} attempt ${number} of ${attempts} got ${response.status}; retrying in ${delay} ms`,
          ),
        );
        await sleep(delay, signal);
        continue;
      }

      const reason = outcome.timedOut
        ? `timed out after ${timeoutMs} ms`
        : `failed: ${errorMessage(outcome.error)}`;
      if (last) {
        throw new ProbaraNetworkError(
          clean(
            `Could not send the ${operation.name} after ${attempts} attempts: the last one ${reason}`,
          ),
          { cause: redactedCause(outcome.error, clean) },
        );
      }
      const delay = backoffMs(number - 1);
      logger.warn(
        clean(`${title} attempt ${number} of ${attempts} ${reason}; retrying in ${delay} ms`),
      );
      await sleep(delay, signal);
    }
  }

  return {
    submitReport(projectId, body, options) {
      const path = `/api/v1/projects/${encodeURIComponent(projectId)}/reports`;
      return post(SUBMIT_REPORT, path, body, options);
    },
    closeRun(runUlid, options) {
      // The route takes no fields, but its body must be JSON (415 otherwise).
      return post(CLOSE_RUN, `/api/v1/runs/${encodeURIComponent(runUlid)}/close`, {}, options);
    },
  };
}
