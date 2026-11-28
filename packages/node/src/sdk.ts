/**
 * The Node SDK: `init` once, then uncaught exceptions and unhandled rejections are sent as events,
 * with the breadcrumbs of what led to them, the source around in-app frames, and the runtime, OS and
 * app they happened in. Each request handled through the middleware has a scope of its own.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';
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
  type ScopeIsolation,
  type User,
} from '@probara/error-core';
import { withProcess } from './context.js';
import { instrumentFetch, type HttpErrorRules } from './fetch.js';
import {
  installProcessHandlers,
  type UncaughtExceptionMode,
  type UnhandledRejectionMode,
} from './process.js';
import { createModuleNames } from './module.js';
import { createModules } from './modules.js';
import { createSourceContext } from './source.js';
import { createNodeTransport, type TransportFactory } from './transport.js';
import { VERSION } from './version.js';

/** The SDK name events carry. */
export const SDK_NAME = 'probara.javascript.node';

/** The most events sent a minute, unless `maxEventsPerMinute` says otherwise. */
export const DEFAULT_MAX_EVENTS_PER_MINUTE = 60;

/** How long `close` waits for the last events, unless told otherwise. */
export const DEFAULT_CLOSE_TIMEOUT_MS = 2000;

/** How often the counts of dropped events are sent. */
export const CLIENT_REPORT_INTERVAL_MS = 60_000;

export interface NodeOptions {
  /** `https://<key>@<host>/`: the project's public ingest key and the Probara API. */
  dsn: string;
  /** Leaves the SDK off when false. */
  enabled?: boolean;
  /** Logs what the SDK does with events to the console, prefixed `[probara]`. */
  debug?: boolean;
  /** `PROBARA_RELEASE`, then the release the bundler plugins inject, unless given. */
  release?: string;
  /** The build of the release, such as a platform or build number. */
  dist?: string;
  /** `PROBARA_ENVIRONMENT`, then `NODE_ENV`, unless given. */
  environment?: string;
  /** A URL that forwards envelopes to Probara instead of the DSN's. */
  tunnel?: string;
  /** Sends envelopes your way: called once with the URL and headers to send them with. */
  transport?: TransportFactory;
  /** Sends the user's email and IP address, and request cookies and client IP headers; off unless true. */
  sendDefaultPii?: boolean;
  /** How deep extra, contexts, user and breadcrumb data are kept: 3 unless given. */
  normalizeDepth?: number;
  /** Truncates messages, exception values, breadcrumb messages and request URLs to this length. */
  maxValueLength?: number;
  /** Adds the stack of the call to messages and to captured values that are not errors. */
  attachStacktrace?: boolean;
  /** Sends the counts of events the SDK dropped, and why: on unless false. */
  sendClientReports?: boolean;
  /** Only errors thrown from these files are sent, when given. */
  allowUrls?: readonly Pattern[];
  /** Errors thrown from these files are never sent. */
  denyUrls?: readonly Pattern[];
  /** The host name unless given. */
  serverName?: string;
  /**
   * The folder the app's paths start from, which frame modules are named from
   * (`src/routes/orders`): the working directory unless given.
   */
  appRoot?: string;
  /** The share of error events sent, from 0 to 1; all of them unless given. */
  sampleRate?: number;
  /** Errors never sent, on top of `ResizeObserver loop`, `AbortError` and `Script error.`. */
  ignoreErrors?: readonly Pattern[];
  /** Changes an event before it is sent, or drops it with `null`. */
  beforeSend?: (event: ProbaraEvent, hint: EventHint) => ProbaraEvent | null;
  /** Changes a breadcrumb before it is kept, or drops it with `null`. */
  beforeBreadcrumb?: (breadcrumb: Breadcrumb, hint?: unknown) => Breadcrumb | null;
  /** How many breadcrumbs an event carries at most: 100 unless given. */
  maxBreadcrumbs?: number;
  /** The most events sent a minute: 60 unless given. */
  maxEventsPerMinute?: number;
  initialScope?: ScopeData;
  /** What an uncaught exception does after it is sent: `exit` (code 1) unless given. */
  onUncaughtException?: UncaughtExceptionMode;
  /** What an unhandled rejection does after it is sent: `warn` (keep running) unless given. */
  onUnhandledRejection?: UnhandledRejectionMode;
  /**
   * Sends failed outgoing `fetch` requests to these URLs as events. HTTP 5xx are only breadcrumbs
   * unless their URL is one of `targets`; 400, 401 and 404 are never sent.
   */
  httpErrors?: HttpErrorRules;
}

interface Active {
  client: Client;
  sendDefaultPii: boolean;
  attachStacktrace: boolean;
  stop(): void;
}

let active: Active | undefined;

const nativeFetch = globalThis.fetch.bind(globalThis);

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** The client of the running SDK, for the middleware. */
export function currentClient(): Client | undefined {
  return active?.client;
}

export function sendsDefaultPii(): boolean {
  return active?.sendDefaultPii === true;
}

function stop(): void {
  const current = active;
  active = undefined;
  current?.stop();
}

/**
 * Starts error monitoring in this process. A second call replaces the first. A DSN that cannot be
 * read leaves the SDK off; nothing here throws.
 */
export function init(options: NodeOptions): void {
  stop();
  const log =
    options.debug === true
      ? (message: string) => {
          console.warn(`[probara] ${message}`);
        }
      : undefined;
  if (options.enabled === false) {
    log?.('The SDK is off: enabled is false.');
    return;
  }
  const dsn = parseDsn(options.dsn);
  if (dsn === null) {
    log?.('The SDK is off: the DSN cannot be read.');
    return;
  }
  const storage = new AsyncLocalStorage<Scope>();
  const isolation: ScopeIsolation = {
    get: () => storage.getStore(),
    run: (scope, callback) => storage.run(scope, callback),
  };
  const serverName = options.serverName ?? safeHostname();
  const addSource = createSourceContext();
  const appRoot = options.appRoot ?? process.cwd();
  const nameModules = createModuleNames(appRoot);
  const addModules = createModules(appRoot);
  const release = options.release ?? env('PROBARA_RELEASE') ?? injectedRelease();
  const transportOptions = {
    url: options.tunnel ?? dsn.endpoint,
    headers: { 'probara-error-key': dsn.key },
  };
  const transport =
    options.transport?.(transportOptions) ?? createNodeTransport(transportOptions, nativeFetch);
  const environment = options.environment ?? env('PROBARA_ENVIRONMENT') ?? env('NODE_ENV');
  const client = createClient({
    dsn: options.dsn,
    platform: 'node',
    sdk: { name: SDK_NAME, version: VERSION },
    send: (body) => transport.send(body),
    enrich: (event) => addModules(nameModules(addSource(withProcess(event, serverName)))),
    isolation,
    maxEventsPerMinute: options.maxEventsPerMinute ?? DEFAULT_MAX_EVENTS_PER_MINUTE,
    ...(release === undefined ? {} : { release }),
    ...(log === undefined ? {} : { log }),
    ...(options.dist === undefined ? {} : { dist: options.dist }),
    ...(options.tunnel === undefined ? {} : { tunnel: options.tunnel }),
    ...(options.allowUrls === undefined ? {} : { allowUrls: options.allowUrls }),
    ...(options.denyUrls === undefined ? {} : { denyUrls: options.denyUrls }),
    ...(options.sendDefaultPii === undefined ? {} : { sendDefaultPii: options.sendDefaultPii }),
    ...(options.normalizeDepth === undefined ? {} : { normalizeDepth: options.normalizeDepth }),
    ...(options.maxValueLength === undefined ? {} : { maxValueLength: options.maxValueLength }),
    ...(options.attachStacktrace === undefined
      ? {}
      : { attachStacktrace: options.attachStacktrace }),
    ...(options.sendClientReports === undefined
      ? {}
      : { sendClientReports: options.sendClientReports }),
    ...(environment === undefined ? {} : { environment }),
    ...(options.sampleRate === undefined ? {} : { sampleRate: options.sampleRate }),
    ...(options.ignoreErrors === undefined ? {} : { ignoreErrors: options.ignoreErrors }),
    ...(options.beforeSend === undefined ? {} : { beforeSend: options.beforeSend }),
    ...(options.beforeBreadcrumb === undefined
      ? {}
      : { beforeBreadcrumb: options.beforeBreadcrumb }),
    ...(options.maxBreadcrumbs === undefined ? {} : { maxBreadcrumbs: options.maxBreadcrumbs }),
    ...(options.initialScope === undefined ? {} : { initialScope: options.initialScope }),
  });
  if (client === null) return;

  const restoreFetch = instrumentFetch(
    () => (active?.client === client ? client : undefined),
    options.httpErrors,
  );
  const uninstall = installProcessHandlers(
    {
      on: (event, listener) => process.on(event, listener),
      off: (event, listener) => process.off(event, listener),
      listenerCount: (event) => process.listenerCount(event),
      exit: (code) => process.exit(code),
    },
    {
      capture(error, mechanism, level) {
        client.withScope((scope) => {
          scope.setLevel(level);
          client.captureException(error, { mechanism });
        });
      },
      flush: (timeoutMs) => flushClient(client, timeoutMs),
      log(message, error) {
        console.error(`[probara] ${message}`, error);
      },
    },
    {
      onUncaughtException: options.onUncaughtException ?? 'exit',
      onUnhandledRejection: options.onUnhandledRejection ?? 'warn',
    },
  );

  const reportTimer = setInterval(() => {
    client.sendClientReport();
  }, CLIENT_REPORT_INTERVAL_MS);
  reportTimer.unref();

  active = {
    client,
    sendDefaultPii: options.sendDefaultPii === true,
    attachStacktrace: options.attachStacktrace === true,
    stop() {
      clearInterval(reportTimer);
      restoreFetch();
      uninstall();
    },
  };
}

function safeHostname(): string | undefined {
  try {
    return hostname();
  } catch {
    return undefined;
  }
}

async function flushClient(client: Client, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([client.flush().then(() => true), timedOut]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves `true` once everything captured so far was sent or dropped, `false` when `timeoutMs`
 * passed first.
 */
export async function flush(timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS): Promise<boolean> {
  const current = active;
  return current === undefined ? true : flushClient(current.client, timeoutMs);
}

/** Stops monitoring and puts `fetch` and the process back, after sending what was captured. */
export async function close(timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS): Promise<boolean> {
  const current = active;
  if (current === undefined) return true;
  stop();
  current.client.sendClientReport();
  void current.client.retryQueued();
  const flushed = await flushClient(current.client, timeoutMs);
  current.client.stopRetries();
  return flushed;
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

/** Sets the user of the next events in this scope, or clears it with `null`. */
export function setUser(user: User | null): void {
  active?.client.scope.setUser(user);
}

export function setTag(key: string, value: string | number | boolean): void {
  active?.client.scope.setTag(key, value);
}

export function setTags(tags: Record<string, string | number | boolean>): void {
  active?.client.scope.setTags(tags);
}

/** Sets a named context of the next events in this scope, or removes it with `null`. */
export function setContext(name: string, context: Record<string, unknown> | null): void {
  active?.client.scope.setContext(name, context);
}

export function setExtra(key: string, value: unknown): void {
  active?.client.scope.setExtra(key, value);
}

export function setExtras(extras: Record<string, unknown>): void {
  active?.client.scope.setExtras(extras);
}

/** Every next event in this scope gets this level. */
export function setLevel(level: Level): void {
  active?.client.scope.setLevel(level);
}

/** Groups the next events in this scope by these parts; `{{ default }}` stands for the usual grouping. */
export function setFingerprint(fingerprint: string[]): void {
  active?.client.scope.setFingerprint(fingerprint);
}

/** The id of the last event captured; `undefined` before any, or while the SDK is off. */
export function lastEventId(): string | undefined {
  return active?.client.lastEventId();
}

/** The scope the next events get: the one `withScope` runs with, or the request's. */
export function getCurrentScope(): Scope {
  return active?.client.scope ?? new Scope();
}

/** The scope of the request the middleware runs, or of the process outside requests. */
export function getIsolationScope(): Scope {
  return active?.client.isolationScope ?? new Scope();
}

export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  active?.client.addBreadcrumb(breadcrumb);
}

/**
 * Runs `callback` with a copy of the current scope, which what it captures gets, including after
 * its `await`s: concurrent work keeps its own tags, user and breadcrumbs.
 */
export function withScope<T>(callback: (scope: Scope) => T): T {
  return active === undefined ? callback(new Scope()) : active.client.withScope(callback);
}
