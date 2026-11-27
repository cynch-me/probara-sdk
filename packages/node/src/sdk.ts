/**
 * The Node SDK: `init` once, then uncaught exceptions and unhandled rejections are sent as events,
 * with the breadcrumbs of what led to them, the source around in-app frames, and the runtime, OS and
 * app they happened in. Each request handled through the middleware has a scope of its own.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';
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
import { createSourceContext } from './source.js';
import { createNodeTransport } from './transport.js';
import { VERSION } from './version.js';

/** The SDK name events carry. */
export const SDK_NAME = 'probara.javascript.node';

/** The most events sent a minute, unless `maxEventsPerMinute` says otherwise. */
export const DEFAULT_MAX_EVENTS_PER_MINUTE = 60;

/** How long `close` waits for the last events, unless told otherwise. */
export const DEFAULT_CLOSE_TIMEOUT_MS = 2000;

export interface NodeOptions {
  /** `https://<key>@<host>/`: the project's public ingest key and the Probara API. */
  dsn: string;
  /** `PROBARA_RELEASE` unless given. */
  release?: string;
  /** `PROBARA_ENVIRONMENT`, then `NODE_ENV`, unless given. */
  environment?: string;
  /** The host name unless given. */
  serverName?: string;
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
  const dsn = parseDsn(options.dsn);
  if (dsn === null) return;
  const storage = new AsyncLocalStorage<Scope>();
  const isolation: ScopeIsolation = {
    get: () => storage.getStore(),
    run: (scope, callback) => storage.run(scope, callback),
  };
  const serverName = options.serverName ?? safeHostname();
  const addSource = createSourceContext();
  const release = options.release ?? env('PROBARA_RELEASE');
  const environment = options.environment ?? env('PROBARA_ENVIRONMENT') ?? env('NODE_ENV');
  const client = createClient({
    dsn: options.dsn,
    platform: 'node',
    sdk: { name: SDK_NAME, version: VERSION },
    send: createNodeTransport(dsn, nativeFetch),
    enrich: (event) => addSource(withProcess(event, serverName)),
    isolation,
    maxEventsPerMinute: options.maxEventsPerMinute ?? DEFAULT_MAX_EVENTS_PER_MINUTE,
    ...(release === undefined ? {} : { release }),
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

  active = {
    client,
    stop() {
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
  return flushClient(current.client, timeoutMs);
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
