/**
 * The browser SDK: `init` once, then the window's uncaught errors and unhandled rejections are
 * sent as events, with the breadcrumbs of what led to them, and the page can capture its own. The
 * console, network and user events come from the page's shared capture, which Probara Vis uses
 * too, so a page running both records them once; the replay, when on, comes from the same capture.
 */
import {
  createClient,
  parseDsn,
  Scope,
  type Breadcrumb,
  type Client,
  type EventHint,
  type Level,
  type Pattern,
  type ProbaraEvent,
  type ScopeData,
  type User,
} from '@probara/error-core';
import {
  attachSharedCapture,
  gzipNdjson,
  matchesUrl,
  redactString,
  type CaptureRecord,
  type SharedCapture,
  type UrlPattern,
} from '@probara/vis-capture';
import { breadcrumbOf, isRequest } from './breadcrumbs.js';
import { browserContexts, withPage } from './context.js';
import { tabSession } from './session.js';
import { createBrowserTransport, type BrowserTransport } from './transport.js';
import { VERSION } from './version.js';

/** How far back the replay uploaded with an event reaches, at least. */
export const REPLAY_LOOKBACK_MS = 60_000;

/** HTTP statuses never sent as events, whatever `httpErrors` says. */
export const NEVER_CAPTURED_STATUSES: readonly number[] = Object.freeze([400, 401, 404]);

/** The SDK name events carry. */
export const SDK_NAME = 'probara.javascript.browser';

export interface BrowserOptions {
  /** `https://<key>@<host>/`: the project's public ingest key and the Probara API. */
  dsn: string;
  release?: string;
  environment?: string;
  /** The share of error events sent, from 0 to 1; all of them unless given. */
  sampleRate?: number;
  /** Errors never sent, on top of `ResizeObserver loop`, `AbortError` and `Script error.`. */
  ignoreErrors?: readonly Pattern[];
  /** Only errors thrown from these files are sent, when given. */
  allowUrls?: readonly Pattern[];
  /** Errors thrown from these files are never sent, on top of browser extensions. */
  denyUrls?: readonly Pattern[];
  /** Changes an event before it is sent, or drops it with `null`. */
  beforeSend?: (event: ProbaraEvent, hint: EventHint) => ProbaraEvent | null;
  /** Changes a breadcrumb before it is kept, or drops it with `null`. */
  beforeBreadcrumb?: (breadcrumb: Breadcrumb, hint?: unknown) => Breadcrumb | null;
  /** How many breadcrumbs an event carries at most: 100 unless given. */
  maxBreadcrumbs?: number;
  initialScope?: ScopeData;
  /**
   * Records a rolling replay of the page, and uploads its last minute for an event when the server
   * asks for it, once per tab session. Off unless enabled.
   */
  replay?: { enabled: boolean };
  /**
   * Sends failed requests to these URLs as events. HTTP 5xx are only breadcrumbs unless their URL
   * is one of `targets`; `statuses` are the statuses or ranges sent, 500–599 unless given; 400,
   * 401 and 404 are never sent.
   */
  httpErrors?: {
    targets: readonly UrlPattern[];
    statuses?: readonly (number | readonly [number, number])[];
  };
}

interface Active {
  client: Client;
  capture: SharedCapture | undefined;
  transport: BrowserTransport;
  replayLoad: Promise<void>;
  stop(): void;
}

let active: Active | undefined;

function statusMatches(
  status: number,
  statuses: readonly (number | readonly [number, number])[],
): boolean {
  if (NEVER_CAPTURED_STATUSES.includes(status)) return false;
  return statuses.some((rule) =>
    typeof rule === 'number' ? rule === status : status >= rule[0] && status <= rule[1],
  );
}

function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof MutationObserver === 'function';
}

/**
 * Starts error monitoring on this page. A second call replaces the first. A DSN that cannot be read
 * leaves the SDK off; nothing here throws into the page.
 */
export function init(options: BrowserOptions): void {
  void close();
  const dsn = parseDsn(options.dsn);
  if (dsn === null) return;
  const session = tabSession();
  const contexts = { ...browserContexts(), session: { id: session.id } };
  const transport = createBrowserTransport(dsn.endpoint);
  let capture: SharedCapture | undefined;
  const client = createClient({
    dsn: options.dsn,
    platform: 'browser',
    sdk: { name: SDK_NAME, version: VERSION },
    send: (body) => transport.send(body),
    scrub: redactString,
    enrich: (event) => withPage(event, contexts),
    ...(options.release === undefined ? {} : { release: options.release }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.sampleRate === undefined ? {} : { sampleRate: options.sampleRate }),
    ...(options.ignoreErrors === undefined ? {} : { ignoreErrors: options.ignoreErrors }),
    ...(options.allowUrls === undefined ? {} : { allowUrls: options.allowUrls }),
    ...(options.denyUrls === undefined ? {} : { denyUrls: options.denyUrls }),
    ...(options.beforeSend === undefined ? {} : { beforeSend: options.beforeSend }),
    ...(options.beforeBreadcrumb === undefined
      ? {}
      : { beforeBreadcrumb: options.beforeBreadcrumb }),
    ...(options.maxBreadcrumbs === undefined ? {} : { maxBreadcrumbs: options.maxBreadcrumbs }),
    ...(options.initialScope === undefined ? {} : { initialScope: options.initialScope }),
    ...(options.replay?.enabled === true
      ? {
          replay: {
            take: async () => {
              const held = capture?.snapshot({ lookbackMs: REPLAY_LOOKBACK_MS }) ?? null;
              return held === null ? null : gzipNdjson(held.events);
            },
            alreadySent: () => session.replaySent(),
            markSent: () => {
              session.markReplaySent();
            },
          },
        }
      : {}),
  });
  if (client === null) {
    transport.close();
    return;
  }
  const endpoint = dsn.endpoint.slice(0, dsn.endpoint.indexOf('?'));

  let previousUrl = '';
  try {
    previousUrl = redactString(location.href);
  } catch {
    previousUrl = '';
  }
  const onRecord = (record: CaptureRecord): void => {
    const crumb = breadcrumbOf(record, previousUrl);
    if (record.stream === 'events' && record.entry.type === 'navigation')
      previousUrl = record.entry.url;
    if (crumb !== null) client.addBreadcrumb(crumb);
    const rules = options.httpErrors;
    if (rules === undefined || !isRequest(record)) return;
    const { status, url, method } = record.entry;
    if (status === null || !statusMatches(status, rules.statuses ?? [[500, 599]])) return;
    if (!matchesUrl(url, rules.targets)) return;
    client.captureEvent(
      {
        level: 'error',
        exception: {
          values: [
            {
              type: 'Error',
              value: `HTTP Client Error with status code: ${String(status)}`,
              mechanism: { type: 'http.client', handled: false, synthetic: true },
            },
          ],
        },
        request: { url, method },
        contexts: { response: { status_code: status } },
      },
      { mechanism: { type: 'http.client', handled: false } },
    );
  };

  try {
    capture = attachSharedCapture({ ignoreUrls: [endpoint] });
    capture.subscribe(onRecord);
  } catch {
    capture = undefined;
  }

  let replayLoad: Promise<void> = Promise.resolve();
  if (options.replay?.enabled === true && capture !== undefined && canCompress()) {
    const target = capture;
    replayLoad = import('@probara/vis-capture/replay')
      .then((module) => {
        target.startReplay(module);
      })
      .catch(() => undefined);
  }

  const onError = (event: Event): void => {
    if (!(event instanceof ErrorEvent) || typeof event.message !== 'string') return;
    const mechanism = { type: 'onerror', handled: false };
    const thrown: unknown = event.error;
    if (thrown !== undefined && thrown !== null) {
      client.captureException(thrown, { mechanism });
      return;
    }
    const frame =
      event.filename === ''
        ? undefined
        : {
            frames: [
              { filename: event.filename, function: '?', lineno: event.lineno, colno: event.colno },
            ],
          };
    client.captureEvent(
      {
        level: 'error',
        exception: {
          values: [
            {
              type: 'Error',
              value: event.message,
              mechanism: { ...mechanism, synthetic: true },
              ...(frame === undefined ? {} : { stacktrace: frame }),
            },
          ],
        },
      },
      { originalException: event, mechanism },
    );
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    client.captureException(event.reason, {
      mechanism: { type: 'onunhandledrejection', handled: false },
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  active = {
    client,
    capture,
    transport,
    replayLoad,
    stop() {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      capture?.release();
      transport.close();
    },
  };
}

/** Sends what was captured so far, then stops monitoring and puts the page back. */
export async function close(): Promise<void> {
  const current = active;
  if (current === undefined) return;
  active = undefined;
  current.stop();
  await current.client.flush().catch(() => undefined);
}

/** Resolves once everything captured so far was sent or dropped. */
export async function flush(): Promise<void> {
  const current = active;
  if (current === undefined) return;
  await current.replayLoad;
  await current.client.flush();
}

/** Sends `exception` as a handled error; returns its event id, empty while the SDK is off. */
export function captureException(exception: unknown, hint?: EventHint): string {
  return active?.client.captureException(exception, hint) ?? '';
}

/** Sends `message` at `level` (`info` unless given); returns its event id. */
export function captureMessage(message: string, level?: Level): string {
  return active?.client.captureMessage(message, level) ?? '';
}

/** Sends an event as given, with the scope added; returns its event id. */
export function captureEvent(event: ProbaraEvent, hint?: EventHint): string {
  return active?.client.captureEvent(event, hint) ?? '';
}

/** Sets the user of the next events, or clears it with `null`: only `id`, `username`, `segment`. */
export function setUser(user: User | null): void {
  active?.client.scope.setUser(user);
}

export function setTag(key: string, value: string | number | boolean): void {
  active?.client.scope.setTag(key, value);
}

export function setTags(tags: Record<string, string | number | boolean>): void {
  active?.client.scope.setTags(tags);
}

/** Sets a named context of the next events, or removes it with `null`. */
export function setContext(name: string, context: Record<string, unknown> | null): void {
  active?.client.scope.setContext(name, context);
}

export function setExtra(key: string, value: unknown): void {
  active?.client.scope.setExtra(key, value);
}

export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  active?.client.addBreadcrumb(breadcrumb);
}

/** Runs `callback` with a copy of the scope, which the events it captures get. */
export function withScope<T>(callback: (scope: Scope) => T): T {
  return active === undefined ? callback(new Scope()) : active.client.withScope(callback);
}
