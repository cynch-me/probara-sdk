/**
 * The browser SDK: `init` once, then the window's uncaught errors and unhandled rejections are
 * sent as events, with the breadcrumbs of what led to them, and the page can capture its own. The
 * console, network and user events come from the page's shared capture, which Probara Vis uses
 * too, so a page running both records them once; the replay, when on, comes from the same capture.
 */
import {
  createClient,
  injectedRelease,
  parseDsn,
  Scope,
  type Breadcrumb,
  type Client,
  type EventHint,
  type Level,
  type Pattern,
  type ProbaraEvent,
  type ScopeData,
  type SdkInfo,
  type User,
} from '@probara/error-core';
import {
  attachSharedCapture,
  gzipNdjson,
  matchesUrl,
  redactString,
  type CaptureRecord,
  type ConsoleLevel,
  type SharedCapture,
  type UrlPattern,
} from '@probara/vis-capture';
import { CONSOLE_LEVELS, DEBUG_PREFIX, breadcrumbOf, isRequest } from './breadcrumbs.js';
import { browserContexts, withPage } from './context.js';
import { instrumentBrowserApis } from './instrument.js';
import { createOfflineStore } from './offline-store.js';
import { loadReplayModule } from './replay-loader.js';
import { tabSession } from './session.js';
import {
  createBrowserTransport,
  type BrowserTransport,
  type TransportFactory,
} from './transport.js';
import { VERSION } from './version.js';

/** How far back the replay uploaded with an event reaches, at least. */
export const REPLAY_LOOKBACK_MS = 60_000;

/** HTTP statuses never sent as events, whatever `httpErrors` says. */
export const NEVER_CAPTURED_STATUSES: readonly number[] = Object.freeze([400, 401, 404]);

/** The SDK name events carry. */
export const SDK_NAME = 'probara.javascript.browser';

export type ReportType = 'crash' | 'deprecation' | 'intervention';

export interface BrowserOptions {
  /** `https://<key>@<host>/`: the project's public ingest key and the Probara API. */
  dsn: string;
  /** Leaves the SDK off when false. */
  enabled?: boolean;
  /** Logs what the SDK does with events to the console, prefixed `[probara]`. */
  debug?: boolean;
  release?: string;
  /** The build of the release, such as `web` or a build number. */
  dist?: string;
  environment?: string;
  /** A URL of your app that forwards envelopes to Probara, so ad blockers do not drop them. */
  tunnel?: string;
  /** Sends envelopes your way: called once with the URL and headers to send them with. */
  transport?: TransportFactory;
  /** Sends the user's email and IP address given to `setUser`; off unless true. */
  sendDefaultPii?: boolean;
  /** How deep extra, contexts, user and breadcrumb data are kept: 3 unless given. */
  normalizeDepth?: number;
  /** Truncates messages, exception values, breadcrumb messages and request URLs to this length. */
  maxValueLength?: number;
  /** Adds the stack of the call to messages and to captured values that are not errors. */
  attachStacktrace?: boolean;
  /** Sends the counts of events the SDK dropped, and why: on unless false. */
  sendClientReports?: boolean;
  /**
   * Captures errors thrown in `setTimeout`, `setInterval`, `requestAnimationFrame` and event
   * listener callbacks with their own stack: on unless false.
   */
  browserApiErrors?: boolean;
  /** Sends console calls of `levels` (all unless given) as message events. Off unless given. */
  captureConsole?: { levels?: readonly ConsoleLevel[] };
  /** Sends the browser's reports of `types` (all unless given) as message events. Off unless given. */
  reportingObserver?: { types?: readonly ReportType[] };
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
  /**
   * For a framework SDK built on this one, such as `@probara/angular`: the SDK name and version
   * events report, and its packages, listed before this one.
   */
  sdk?: SdkInfo;
}

/** The SDK events report: `sdk` when a framework SDK gives one, listing this package last. */
function sdkOf(sdk: SdkInfo | undefined): SdkInfo {
  const own = { name: 'npm:@probara/browser', version: VERSION };
  if (sdk === undefined) return { name: SDK_NAME, version: VERSION, packages: [own] };
  return { name: sdk.name, version: sdk.version, packages: [...(sdk.packages ?? []), own] };
}

interface Active {
  client: Client;
  capture: SharedCapture | undefined;
  replayLoad: Promise<void>;
  attachStacktrace: boolean;
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

function debugLog(message: string): void {
  console.warn(`${DEBUG_PREFIX} ${message}`);
}

function reportDetails(report: { type: string; body?: Record<string, unknown> | null }): string {
  const body = report.body;
  if (body === undefined || body === null) return 'No details available';
  if (report.type === 'crash') {
    const parts = [body['crashId'], body['reason']].filter(
      (part): part is string => typeof part === 'string' && part !== '',
    );
    return parts.length === 0 ? 'No details available' : parts.join(' ');
  }
  return typeof body['message'] === 'string' ? body['message'] : 'No details available';
}

function plainBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const out: Record<string, unknown> = {};
  for (const key in body) out[key] = (body as Record<string, unknown>)[key];
  return out;
}

interface Report {
  type: string;
  url: string;
  body?: Record<string, unknown> | null;
}

type ReportingObserverClass = new (
  handler: (reports: Report[]) => void,
  options: { buffered: boolean; types: readonly ReportType[] },
) => { observe(): void; disconnect(): void };

function observeReports(client: Client, types: readonly ReportType[]): () => void {
  const Observer = (window as unknown as { ReportingObserver?: ReportingObserverClass })
    .ReportingObserver;
  if (typeof Observer !== 'function') return () => undefined;
  const observer = new Observer(
    (reports) => {
      for (const report of reports) {
        client.withScope((scope) => {
          scope.setExtra('url', report.url);
          const body = plainBody(report.body);
          if (body !== undefined) scope.setExtra('body', body);
          client.captureMessage(`ReportingObserver [${report.type}]: ${reportDetails(report)}`);
        });
      }
    },
    { buffered: true, types },
  );
  observer.observe();
  return () => {
    observer.disconnect();
  };
}

/**
 * Starts error monitoring on this page. A second call replaces the first. A DSN that cannot be read
 * leaves the SDK off; nothing here throws into the page.
 */
export function init(options: BrowserOptions): void {
  void close();
  const log = options.debug === true ? debugLog : undefined;
  if (options.enabled === false) {
    log?.('The SDK is off: enabled is false.');
    return;
  }
  const dsn = parseDsn(options.dsn);
  if (dsn === null) {
    log?.('The SDK is off: the DSN cannot be read.');
    return;
  }
  const session = tabSession();
  const contexts = { ...browserContexts(), session: { id: session.id } };
  const url = options.tunnel ?? dsn.endpoint;
  const release = options.release ?? injectedRelease();
  const custom = options.transport?.({ url, headers: {} });
  const transport: BrowserTransport | undefined =
    custom === undefined ? createBrowserTransport(url) : undefined;
  const sender = custom ?? transport;
  if (sender === undefined) return;
  let capture: SharedCapture | undefined;
  const client = createClient({
    dsn: options.dsn,
    platform: 'browser',
    sdk: sdkOf(options.sdk),
    send: (body) => sender.send(body),
    scrub: redactString,
    enrich: (event) => withPage(event, contexts),
    store: createOfflineStore(),
    isOnline: () => navigator.onLine,
    ...(log === undefined ? {} : { log }),
    ...(options.tunnel === undefined ? {} : { tunnel: options.tunnel }),
    ...(release === undefined ? {} : { release }),
    ...(options.dist === undefined ? {} : { dist: options.dist }),
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
    ...(options.sendDefaultPii === undefined ? {} : { sendDefaultPii: options.sendDefaultPii }),
    ...(options.normalizeDepth === undefined ? {} : { normalizeDepth: options.normalizeDepth }),
    ...(options.maxValueLength === undefined ? {} : { maxValueLength: options.maxValueLength }),
    ...(options.attachStacktrace === undefined
      ? {}
      : { attachStacktrace: options.attachStacktrace }),
    ...(options.sendClientReports === undefined
      ? {}
      : { sendClientReports: options.sendClientReports }),
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
    transport?.close();
    return;
  }
  const ignoredUrls = [dsn.endpoint.slice(0, dsn.endpoint.indexOf('?'))];
  if (options.tunnel !== undefined) ignoredUrls.push(options.tunnel);
  const consoleLevels = options.captureConsole?.levels;

  let previousUrl = '';
  try {
    previousUrl = redactString(location.href);
  } catch {
    previousUrl = '';
  }
  const onConsole = (record: CaptureRecord): void => {
    if (record.stream !== 'console' || options.captureConsole === undefined) return;
    const { level, args } = record.entry;
    if (consoleLevels !== undefined && !consoleLevels.includes(level)) return;
    if (breadcrumbOf(record, previousUrl) === null) return;
    client.captureEvent({
      message: args.join(' '),
      level: CONSOLE_LEVELS[level],
      logger: 'console',
      extra: { arguments: [...args] },
    });
  };
  const onRecord = (record: CaptureRecord): void => {
    const crumb = breadcrumbOf(record, previousUrl);
    if (record.stream === 'events' && record.entry.type === 'navigation')
      previousUrl = record.entry.url;
    if (crumb !== null) client.addBreadcrumb(crumb);
    onConsole(record);
    const rules = options.httpErrors;
    if (rules === undefined || !isRequest(record)) return;
    const { status, url: requestUrl, method } = record.entry;
    if (status === null || !statusMatches(status, rules.statuses ?? [[500, 599]])) return;
    if (!matchesUrl(requestUrl, rules.targets)) return;
    captureHttpError({ url: requestUrl, method, status });
  };

  try {
    capture = attachSharedCapture({ ignoreUrls: ignoredUrls, retention: 'errors' });
    capture.subscribe(onRecord);
  } catch {
    capture = undefined;
  }

  let replayLoad: Promise<void> = Promise.resolve();
  if (options.replay?.enabled === true && capture !== undefined && canCompress()) {
    const target = capture;
    replayLoad = loadReplayModule()
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
  const onOnline = (): void => {
    void client.retryQueued();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') client.sendClientReport();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
  instrumentBrowserApis(
    options.browserApiErrors === false
      ? undefined
      : (error, mechanism) => {
          if (active?.client === client) client.captureException(error, { mechanism });
        },
  );
  const stopReports =
    options.reportingObserver === undefined
      ? () => undefined
      : observeReports(
          client,
          options.reportingObserver.types ?? ['crash', 'deprecation', 'intervention'],
        );
  void client.retryQueued();

  active = {
    client,
    capture,
    replayLoad,
    attachStacktrace: options.attachStacktrace === true,
    stop() {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      instrumentBrowserApis(undefined);
      stopReports();
      client.stopRetries();
      capture?.release();
      transport?.close();
    },
  };
}

/** Sends what was captured so far, then stops monitoring and puts the page back. */
export async function close(): Promise<void> {
  const current = active;
  if (current === undefined) return;
  active = undefined;
  current.client.sendClientReport();
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

/**
 * Sends a failed HTTP request as an unhandled event, its URL redacted: what a framework's HTTP
 * client reports (`mechanism` names it). Never for 400, 401 or 404; returns the event id, empty
 * when nothing was sent.
 */
export function captureHttpError(
  request: { url: string; method: string; status: number },
  mechanism = 'http.client',
): string {
  const client = active?.client;
  if (client === undefined || NEVER_CAPTURED_STATUSES.includes(request.status)) return '';
  let url: string;
  try {
    url = redactString(request.url);
  } catch {
    url = '';
  }
  return client.captureEvent(
    {
      level: 'error',
      exception: {
        values: [
          {
            type: 'Error',
            value: `HTTP Client Error with status code: ${String(request.status)}`,
            mechanism: { type: mechanism, handled: false, synthetic: true },
          },
        ],
      },
      request: { url, method: request.method.toUpperCase() },
      contexts: { response: { status_code: request.status } },
    },
    { mechanism: { type: mechanism, handled: false } },
  );
}

/** Sends `exception` as a handled error; returns its event id, empty while the SDK is off. */
export function captureException(exception: unknown, hint?: EventHint): string {
  const current = active;
  if (current === undefined) return '';
  return current.client.captureException(
    exception,
    current.attachStacktrace ? { syntheticException: new Error(), ...hint } : hint,
  );
}

/** Sends `message` at `level` (`info` unless given); returns its event id. */
export function captureMessage(message: string, level?: Level): string {
  const current = active;
  if (current === undefined) return '';
  return current.client.captureMessage(
    message,
    level,
    current.attachStacktrace ? { syntheticException: new Error(message) } : {},
  );
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

export function setExtras(extras: Record<string, unknown>): void {
  active?.client.scope.setExtras(extras);
}

/** Every next event gets this level. */
export function setLevel(level: Level): void {
  active?.client.scope.setLevel(level);
}

/** Groups the next events by these parts; `{{ default }}` stands for the usual grouping. */
export function setFingerprint(fingerprint: string[]): void {
  active?.client.scope.setFingerprint(fingerprint);
}

/** The id of the last event captured; `undefined` before any, or while the SDK is off. */
export function lastEventId(): string | undefined {
  return active?.client.lastEventId();
}

/** The scope the next events get: the one `withScope` runs with, or the page's. */
export function getCurrentScope(): Scope {
  return active?.client.scope ?? new Scope();
}

/** The scope of the whole page, which every event gets. */
export function getIsolationScope(): Scope {
  return active?.client.isolationScope ?? new Scope();
}

export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  active?.client.addBreadcrumb(breadcrumb);
}

/** Runs `callback` with a copy of the scope, which the events it captures get. */
export function withScope<T>(callback: (scope: Scope) => T): T {
  return active === undefined ? callback(new Scope()) : active.client.withScope(callback);
}
