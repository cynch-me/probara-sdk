/**
 * Network capture: `fetch`, `XMLHttpRequest`, `navigator.sendBeacon` and the resources the page
 * loads (from the Performance API), recorded into a session as network entries. It never changes
 * what the page's calls return, throw or receive: a response body is read from a clone, and an
 * error inside capture is swallowed. `stop()` restores what `start()` replaced, and only where
 * the current value is still its own wrapper.
 */
import type {
  EntryTime,
  NetworkBody,
  NetworkEntry,
  NetworkKind,
  NetworkTiming,
} from './entries.js';
import { graphqlHasErrors, graphqlOperation } from './graphql.js';
import {
  DEFAULT_BODY_LIMITS,
  omittedBody,
  readRequestBody,
  readResponseBody,
  textBody,
  type BodyLimits,
} from './network-body.js';
import { sanitizeNetworkEntry, type RequestSanitizer, type ResponseSanitizer } from './sanitize.js';
import type { RecordingSession } from './session.js';

/** The window whose network is captured: `globalThis` unless another is given. */
export type NetworkCaptureTarget = Pick<
  Window & typeof globalThis,
  'fetch' | 'XMLHttpRequest' | 'navigator' | 'performance' | 'PerformanceObserver' | 'location'
>;

/** A URL to leave out: a string matches the URLs it starts, a RegExp the URLs it matches. */
export type UrlPattern = string | RegExp;

export interface NetworkCaptureOptions extends Partial<BodyLimits> {
  requestSanitizer?: RequestSanitizer;
  responseSanitizer?: ResponseSanitizer;
  /** Requests to these URLs are not recorded, such as the endpoint recordings are uploaded to. */
  ignoreUrls?: readonly UrlPattern[];
  target?: NetworkCaptureTarget;
}

export interface NetworkCapture {
  readonly active: boolean;
  /** Wraps `fetch`, `XMLHttpRequest` and `sendBeacon`, and observes resources. */
  start(): void;
  /** Restores what `start()` replaced. A request already started is still recorded when it ends. */
  stop(): void;
}

/** `url` matches one of `patterns`. */
export function matchesUrl(url: string, patterns: readonly UrlPattern[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') return url.startsWith(pattern);
    pattern.lastIndex = 0;
    return pattern.test(url);
  });
}

/**
 * Replaces `object[key]` with `replacement`; the function returned puts back exactly what was
 * there (an own property, or none) while `object[key]` is still `replacement`.
 */
export function replaceProperty(object: object, key: string, replacement: unknown): () => void {
  const own = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, {
    value: replacement,
    writable: true,
    configurable: true,
    enumerable: own?.enumerable ?? true,
  });
  return () => {
    if ((object as Record<string, unknown>)[key] !== replacement) return;
    if (own === undefined) Reflect.deleteProperty(object, key);
    else Object.defineProperty(object, key, own);
  };
}

/** The headline of a thrown value: `TypeError: Failed to fetch`. */
export function describeError(error: unknown): string {
  try {
    if (typeof error === 'object' && error !== null) {
      const { name, message } = error as { name?: unknown; message?: unknown };
      if (typeof name === 'string' && typeof message === 'string') {
        return message === '' ? name : `${name}: ${message}`;
      }
    }
    return String(error);
  } catch {
    return 'Error';
  }
}

/** The `[object X]` tag of a value: it holds across windows, where `instanceof` does not. */
function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1);
}

const ID_PREFIX = Math.random().toString(36).slice(2, 8);
let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `req-${ID_PREFIX}-${String(sequence)}`;
}

/** The phases of a resource timing entry the browser exposes (cross-origin ones may be hidden). */
function timingOf(entry: PerformanceResourceTiming): NetworkTiming | null {
  const timing: NetworkTiming = {};
  const phase = (from: number, to: number): number | undefined =>
    from > 0 && to >= from ? Math.round(to - from) : undefined;
  const set = (key: keyof NetworkTiming, value: number | undefined) => {
    if (value !== undefined) timing[key] = value;
  };
  set(
    'startMs',
    entry.requestStart > 0 ? Math.round(entry.requestStart - entry.startTime) : undefined,
  );
  set('dnsMs', phase(entry.domainLookupStart, entry.domainLookupEnd));
  set('connectMs', phase(entry.connectStart, entry.connectEnd));
  set('tlsMs', phase(entry.secureConnectionStart, entry.connectEnd));
  set('ttfbMs', phase(entry.requestStart, entry.responseStart));
  set('responseMs', phase(entry.responseStart, entry.responseEnd));
  return Object.keys(timing).length === 0 ? null : timing;
}

function headersOf(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/** Parses `getAllResponseHeaders()`. */
function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    out[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return out;
}

const RESOURCE_INITIATOR: Partial<Record<NetworkKind, string>> = {
  fetch: 'fetch',
  xhr: 'xmlhttprequest',
  beacon: 'beacon',
};

/** What is known of a request when it starts. */
interface Pending {
  id: string;
  kind: NetworkKind;
  method: string;
  url: string;
  start: EntryTime;
  /** `performance.now()` of the target window when it started. */
  startedAt: number;
  requestHeaders: Record<string, string>;
  requestBody: Promise<NetworkBody | null>;
}

/** What is known of a request when it ends. */
interface Outcome {
  status: number | null;
  responseHeaders: Record<string, string>;
  responseBody: NetworkBody | null;
  error: string | null;
  end: EntryTime;
}

type Method = (...args: never[]) => unknown;
type XhrState = { method: string; url: string; headers: Record<string, string> };

export function createNetworkCapture(
  session: RecordingSession,
  options: NetworkCaptureOptions = {},
): NetworkCapture {
  const target: NetworkCaptureTarget = options.target ?? globalThis;
  const limits: BodyLimits = {
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_BODY_LIMITS.maxBodyBytes,
    maxBodyReadBytes: options.maxBodyReadBytes ?? DEFAULT_BODY_LIMITS.maxBodyReadBytes,
    bodyReadTimeoutMs: options.bodyReadTimeoutMs ?? DEFAULT_BODY_LIMITS.bodyReadTimeoutMs,
  };
  const ignoreUrls = options.ignoreUrls ?? [];
  const restores: (() => void)[] = [];
  const xhrStates = new WeakMap<XMLHttpRequest, XhrState>();
  /** Resource timing entries already matched to a request. */
  const matched = new Set<string>();
  let observer: PerformanceObserver | undefined;
  let active = false;
  /** Set while a sanitizer runs: a request it makes is not recorded. */
  let busy = false;

  const capturing = () => active && !busy && session.state === 'recording';

  function absolute(url: string): string {
    try {
      return new URL(url, target.location.href).href;
    } catch {
      return url;
    }
  }

  function now(): number {
    try {
      return target.performance.now();
    } catch {
      return 0;
    }
  }

  function begin(
    kind: NetworkKind,
    method: string,
    url: string,
    requestHeaders: Record<string, string>,
    requestBody: () => Promise<NetworkBody | null>,
  ): Pending | undefined {
    if (matchesUrl(url, ignoreUrls)) return undefined;
    const body = requestBody().catch(() => omittedBody('unsupported', null));
    return {
      id: nextId(),
      kind,
      method: method.toUpperCase(),
      url,
      start: session.stamp(),
      startedAt: now(),
      requestHeaders,
      requestBody: body,
    };
  }

  function findTiming(pending: Pending): PerformanceResourceTiming | undefined {
    const initiator = RESOURCE_INITIATOR[pending.kind];
    let candidates: PerformanceEntryList;
    try {
      candidates = target.performance.getEntriesByName(pending.url, 'resource');
    } catch {
      return undefined;
    }
    for (const candidate of candidates as PerformanceResourceTiming[]) {
      const key = `${candidate.name} ${String(candidate.startTime)}`;
      if (
        candidate.initiatorType === initiator &&
        candidate.startTime >= pending.startedAt - 1 &&
        !matched.has(key)
      ) {
        matched.add(key);
        return candidate;
      }
    }
    return undefined;
  }

  function keep(entry: NetworkEntry): void {
    busy = true;
    try {
      const kept = sanitizeNetworkEntry(entry, options);
      if (kept !== null) session.record('network', kept);
    } finally {
      busy = false;
    }
  }

  async function finish(pending: Pending, outcome: Outcome): Promise<void> {
    try {
      const requestBody = await pending.requestBody;
      let resource = findTiming(pending);
      if (resource === undefined && pending.kind !== 'beacon') {
        // The browser adds the timing entry once the response ended: give it one task.
        await new Promise((resolve) => setTimeout(resolve, 0));
        resource = findTiming(pending);
      }
      const operation = graphqlOperation({
        method: pending.method,
        url: pending.url,
        contentType: pending.requestHeaders['content-type'] ?? null,
        body: requestBody?.text ?? null,
      });
      keep({
        t: pending.start.t,
        ts: pending.start.ts,
        id: pending.id,
        kind: pending.kind,
        method: pending.method,
        url: pending.url,
        status: outcome.status,
        requestHeaders: pending.requestHeaders,
        responseHeaders: outcome.responseHeaders,
        requestBody,
        responseBody: outcome.responseBody,
        durationMs: pending.kind === 'beacon' ? null : Math.max(0, outcome.end.t - pending.start.t),
        timing: resource === undefined ? null : timingOf(resource),
        error: outcome.error,
        graphql:
          operation === null
            ? null
            : { ...operation, hasErrors: graphqlHasErrors(outcome.responseBody?.text ?? null) },
      });
    } catch {
      // Capture never breaks the page.
    }
  }

  function failed(pending: Pending, error: unknown): void {
    void finish(pending, {
      status: null,
      responseHeaders: {},
      responseBody: null,
      error: describeError(error),
      end: session.stamp(),
    });
  }

  // fetch -----------------------------------------------------------------------------------------

  function beginFetch(input: unknown, init: RequestInit | undefined): Pending | undefined {
    const request = tagOf(input) === 'Request' ? (input as Request) : undefined;
    const url = absolute(request?.url ?? String(input));
    const headers = headersOf(new Headers(init?.headers ?? request?.headers));
    const method = init?.method ?? request?.method ?? 'GET';
    let body: () => Promise<NetworkBody | null>;
    if (init?.body !== undefined && init.body !== null) {
      const value = init.body;
      body = () => readRequestBody(value, headers['content-type'] ?? null, limits);
    } else if (request !== undefined && request.body !== null && !request.bodyUsed) {
      // Cloned now, before `fetch` consumes the request's body.
      const clone = request.clone();
      body = () => readResponseBody(clone, limits);
    } else {
      body = () => Promise.resolve(null);
    }
    return begin('fetch', method, url, headers, body);
  }

  function fetched(pending: Pending, response: Response): void {
    const opaque = response.type === 'opaque' || response.type === 'opaqueredirect';
    const status = opaque || response.status === 0 ? null : response.status;
    const responseHeaders = headersOf(response.headers);
    const headersAt = session.stamp();
    // Cloned before the page gets the response, so its body is never consumed.
    const clone = response.clone();
    void (async () => {
      let responseBody: NetworkBody | null;
      let error: string | null = null;
      try {
        responseBody = await readResponseBody(clone, limits);
      } catch (readError) {
        responseBody = null;
        error = describeError(readError);
      }
      const read = responseBody !== null && responseBody.text !== null;
      await finish(pending, {
        status,
        responseHeaders,
        responseBody,
        error,
        end: read ? session.stamp() : headersAt,
      });
    })();
  }

  function wrapFetch(original: typeof fetch): typeof fetch {
    return function fetch(this: unknown, ...args: Parameters<typeof globalThis.fetch>) {
      let pending: Pending | undefined;
      if (capturing()) {
        try {
          pending = beginFetch(args[0], args[1]);
        } catch {
          pending = undefined;
        }
      }
      const result = original.apply(this, args);
      if (pending === undefined) return result;
      const started = pending;
      try {
        return result.then(
          (response) => {
            try {
              fetched(started, response);
            } catch (error) {
              failed(started, error);
            }
            return response;
          },
          (error: unknown) => {
            failed(started, error);
            throw error;
          },
        );
      } catch {
        return result;
      }
    };
  }

  // XMLHttpRequest --------------------------------------------------------------------------------

  async function xhrResponseBody(xhr: XMLHttpRequest): Promise<NetworkBody | null> {
    const contentType = xhr.getResponseHeader('content-type');
    const mime = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (mime === 'text/event-stream') return omittedBody('stream', null);
    switch (xhr.responseType) {
      case '':
      case 'text': {
        const text = xhr.responseText;
        if (text === '' && xhr.status === 0) return null;
        // Two UTF-16 units at most per UTF-8 byte above the limit: not worth encoding whole.
        if (text.length > limits.maxBodyReadBytes) return omittedBody('too_large', null);
        return textBody(text, limits.maxBodyBytes);
      }
      case 'json':
        return xhr.response === null
          ? null
          : textBody(JSON.stringify(xhr.response), limits.maxBodyBytes);
      default:
        return readRequestBody(xhr.response, contentType, limits);
    }
  }

  function watchXhr(xhr: XMLHttpRequest, pending: Pending): void {
    let error: string | null = null;
    const onEvent = (event: Event) => {
      try {
        if (event.type === 'error') error = 'Network error';
        else if (event.type === 'abort') error = 'Aborted';
        else if (event.type === 'timeout') error = 'Timeout';
        if (event.type !== 'loadend') return;
        for (const type of ['error', 'abort', 'timeout', 'loadend']) {
          xhr.removeEventListener(type, onEvent);
        }
        const end = session.stamp();
        const status = xhr.status === 0 ? null : xhr.status;
        const responseHeaders =
          status === null ? {} : parseHeaderLines(xhr.getAllResponseHeaders());
        const body = status === null ? Promise.resolve(null) : xhrResponseBody(xhr);
        void body
          .catch(() => omittedBody('unsupported', null))
          .then((responseBody) =>
            finish(pending, { status, responseHeaders, responseBody, error, end }),
          );
      } catch {
        // Capture never breaks the page.
      }
    };
    for (const type of ['error', 'abort', 'timeout', 'loadend']) {
      xhr.addEventListener(type, onEvent);
    }
  }

  function patchXhr(proto: XMLHttpRequest): void {
    const methods = proto as unknown as Record<string, Method>;
    const open = methods['open'] as Method;
    const setRequestHeader = methods['setRequestHeader'] as Method;
    const send = methods['send'] as Method;
    restores.push(
      replaceProperty(proto, 'open', function (this: XMLHttpRequest, ...args: unknown[]) {
        try {
          xhrStates.set(this, {
            method: String(args[0]),
            url: absolute(String(args[1])),
            headers: {},
          });
        } catch {
          // Capture never breaks the page.
        }
        return open.apply(this, args as never[]);
      }),
      replaceProperty(
        proto,
        'setRequestHeader',
        function (this: XMLHttpRequest, ...args: unknown[]) {
          const result = setRequestHeader.apply(this, args as never[]);
          try {
            const state = xhrStates.get(this);
            if (state !== undefined) {
              const name = String(args[0]).toLowerCase();
              const value = String(args[1]);
              const previous = state.headers[name];
              state.headers[name] = previous === undefined ? value : `${previous}, ${value}`;
            }
          } catch {
            // Capture never breaks the page.
          }
          return result;
        },
      ),
      replaceProperty(proto, 'send', function (this: XMLHttpRequest, ...args: unknown[]) {
        try {
          const state = xhrStates.get(this);
          if (state !== undefined && capturing()) {
            const body = args[0];
            const pending = begin('xhr', state.method, state.url, { ...state.headers }, () =>
              readRequestBody(body, state.headers['content-type'] ?? null, limits),
            );
            if (pending !== undefined) watchXhr(this, pending);
          }
        } catch {
          // Capture never breaks the page.
        }
        return send.apply(this, args as never[]);
      }),
    );
  }

  // sendBeacon ------------------------------------------------------------------------------------

  function beaconType(data: unknown): string | null {
    if (typeof data === 'string') return 'text/plain;charset=UTF-8';
    const tag = tagOf(data);
    if (tag === 'URLSearchParams') return 'application/x-www-form-urlencoded;charset=UTF-8';
    if ((tag === 'Blob' || tag === 'File') && (data as Blob).type !== '')
      return (data as Blob).type;
    return null;
  }

  function wrapBeacon(original: Navigator['sendBeacon']): Navigator['sendBeacon'] {
    return function sendBeacon(this: Navigator, ...args: Parameters<Navigator['sendBeacon']>) {
      let pending: Pending | undefined;
      if (capturing()) {
        try {
          const data = args[1];
          const type = beaconType(data);
          const headers: Record<string, string> = type === null ? {} : { 'content-type': type };
          pending = begin('beacon', 'POST', absolute(String(args[0])), headers, () =>
            readRequestBody(data, type, limits),
          );
        } catch {
          pending = undefined;
        }
      }
      let queued: boolean;
      try {
        queued = original.apply(this, args);
      } catch (error) {
        if (pending !== undefined) failed(pending, error);
        throw error;
      }
      if (pending !== undefined) {
        void finish(pending, {
          status: null,
          responseHeaders: {},
          responseBody: null,
          error: queued ? null : 'The browser did not queue the beacon',
          end: session.stamp(),
        });
      }
      return queued;
    } as Navigator['sendBeacon'];
  }

  // Resources -------------------------------------------------------------------------------------

  function onResources(list: PerformanceObserverEntryList): void {
    if (!capturing()) return;
    for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
      try {
        if (['fetch', 'xmlhttprequest', 'beacon'].includes(entry.initiatorType)) continue;
        if (matchesUrl(entry.name, ignoreUrls)) continue;
        const stamp = session.stamp();
        const age = Math.max(0, now() - entry.startTime);
        const status = (entry as { responseStatus?: number }).responseStatus;
        keep({
          t: Math.max(0, Math.round(stamp.t - age)),
          ts: Math.round(stamp.ts - age),
          id: nextId(),
          kind: 'resource',
          method: 'GET',
          url: entry.name,
          status: typeof status === 'number' && status > 0 ? status : null,
          requestHeaders: {},
          responseHeaders: {},
          requestBody: null,
          responseBody: null,
          durationMs: Math.round(entry.duration),
          timing: timingOf(entry),
          error: null,
          graphql: null,
        });
      } catch {
        // Capture never breaks the page.
      }
    }
  }

  return {
    get active() {
      return active;
    },
    start() {
      if (active) return;
      const attempt = (install: () => void) => {
        try {
          install();
        } catch {
          // A frozen or missing API: capture what could be wrapped.
        }
      };
      attempt(() => {
        if (typeof target.fetch === 'function') {
          restores.push(replaceProperty(target, 'fetch', wrapFetch(target.fetch)));
        }
      });
      attempt(() => {
        if (typeof target.XMLHttpRequest === 'function') patchXhr(target.XMLHttpRequest.prototype);
      });
      attempt(() => {
        const navigator = target.navigator;
        const sendBeacon: unknown = Reflect.get(navigator, 'sendBeacon');
        if (typeof sendBeacon === 'function') {
          restores.push(
            replaceProperty(
              navigator,
              'sendBeacon',
              wrapBeacon(sendBeacon as Navigator['sendBeacon']),
            ),
          );
        }
      });
      attempt(() => {
        observer = new target.PerformanceObserver(onResources);
        observer.observe({ type: 'resource' });
      });
      active = true;
    },
    stop() {
      if (!active) return;
      active = false;
      for (const restore of restores.splice(0).reverse()) {
        try {
          restore();
        } catch {
          // Never throw into the page.
        }
      }
      try {
        observer?.disconnect();
      } catch {
        // Never throw into the page.
      }
      observer = undefined;
      matched.clear();
    },
  };
}
