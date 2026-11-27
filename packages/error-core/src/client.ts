/**
 * The error client: captures errors and messages into events with the scope added, filters them on
 * the client as the SDK options say, and sends them as envelopes, silently: a failure never
 * reaches the app. When the server asks for a replay of an event, it uploads one, once per session.
 */
import { withDebugImages } from './debug-ids.js';
import { parseDsn, type Dsn } from './dsn.js';
import type { EnvelopeItem } from './envelope.js';
import { exceptionValues } from './exception.js';
import {
  DEFAULT_DENY_URLS,
  DEFAULT_IGNORE_ERRORS,
  matches,
  messagesOf,
  urlOf,
  type Pattern,
} from './filters.js';
import { randomId } from './ids.js';
import { DEFAULT_NORMALIZE_DEPTH, normalize, truncate } from './normalize.js';
import { Scope, type ScopeData } from './scope.js';
import { parseStackTrace } from './stack.js';
import {
  createMemoryStore,
  createTransport,
  defaultSchedule,
  type DataCategory,
  type DiscardReason,
  type DiscardedEvents,
  type EnvelopeStore,
  type Schedule,
  type SendRequest,
} from './transport.js';
import type {
  Breadcrumb,
  EventHint,
  ExceptionValue,
  Level,
  Platform,
  ProbaraEvent,
  SdkInfo,
  User,
} from './types.js';

/** Breadcrumbs kept unless `maxBreadcrumbs` says otherwise. */
export const DEFAULT_MAX_BREADCRUMBS = 100;

/** The most events sent in `RATE_LIMIT_WINDOW_MS`; the others are dropped. */
export const RATE_LIMIT_EVENTS = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** How long sending pauses after a `429` without a readable `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * Where the current scope lives when the platform runs many things at once (a Node server's
 * requests): `get` hands out the scope of the running task, `run` runs `callback` with `scope`.
 */
export interface ScopeIsolation {
  get(): Scope | undefined;
  run<T>(scope: Scope, callback: () => T): T;
}

/** The replay of the session, handed over when the server asks for one. */
export interface ReplayProvider {
  /** The gzip-compressed replay to upload for `eventId`; `null` when there is none. */
  take(eventId: string): Promise<Uint8Array | null>;
  /** A replay was already uploaded in this session. */
  alreadySent(): boolean;
  markSent(): void;
}

export interface ClientOptions {
  dsn: string;
  platform: Platform;
  sdk: SdkInfo;
  /** Sends an envelope; resolves what came back, or rejects when nothing did. */
  send: SendRequest;
  release?: string;
  dist?: string;
  environment?: string;
  /** Envelopes go through this URL of the app, so their header carries the DSN. */
  tunnel?: string;
  /** The share of events sent, from 0 to 1; all of them unless given. */
  sampleRate?: number;
  /** Errors and messages never sent, on top of `DEFAULT_IGNORE_ERRORS`. */
  ignoreErrors?: readonly Pattern[];
  /** Only errors thrown from these files are sent, when given. */
  allowUrls?: readonly Pattern[];
  /** Errors thrown from these files are never sent, on top of `DEFAULT_DENY_URLS`. */
  denyUrls?: readonly Pattern[];
  /** Changes an event before it is sent, or drops it with `null`. */
  beforeSend?: (event: ProbaraEvent, hint: EventHint) => ProbaraEvent | null;
  /** Changes a breadcrumb before it is kept, or drops it with `null`. */
  beforeBreadcrumb?: (breadcrumb: Breadcrumb, hint?: unknown) => Breadcrumb | null;
  maxBreadcrumbs?: number;
  initialScope?: ScopeData;
  /** Sends the user's email and IP address; off unless true. */
  sendDefaultPii?: boolean;
  /** How deep extra, contexts, user and breadcrumb data are kept: 3 unless given, 0 for all. */
  normalizeDepth?: number;
  /** The longest messages, exception values, breadcrumb messages and request URLs sent. */
  maxValueLength?: number;
  /** Adds the stack of the call to messages and to values that are not errors. */
  attachStacktrace?: boolean;
  /** Sends the counts of the events the SDK dropped: on unless false. */
  sendClientReports?: boolean;
  /** Where the SDK says what it does with events, for `debug`. */
  log?: (message: string) => void;
  /** Removes secrets from text: messages, exception values and breadcrumb messages. */
  scrub?: (text: string) => string;
  /** Adds what the platform knows (contexts, request) to each event. */
  enrich?: (event: ProbaraEvent) => ProbaraEvent;
  replay?: ReplayProvider;
  /** Hands out the scope of the running task; without it, one scope holds for the whole page. */
  isolation?: ScopeIsolation;
  /** The most events sent a minute: `RATE_LIMIT_EVENTS` unless given. */
  maxEventsPerMinute?: number;
  /** Where envelopes that failed to send wait for their retry: in memory unless given. */
  store?: EnvelopeStore;
  /** Whether the platform is online; envelopes wait in the store while it is not. */
  isOnline?: () => boolean;
  schedule?: Schedule;
  now?: () => number;
  random?: () => number;
}

export interface Client {
  readonly dsn: Dsn;
  /** The scope of the events captured outside `withScope`. */
  readonly scope: Scope;
  /** The scope of the page, or of the request running. */
  readonly isolationScope: Scope;
  captureException(exception: unknown, hint?: EventHint): string;
  captureMessage(message: string, level?: Level, hint?: EventHint): string;
  captureEvent(event: ProbaraEvent, hint?: EventHint): string;
  addBreadcrumb(breadcrumb: Breadcrumb, hint?: unknown): void;
  /** Runs `callback` with a copy of the scope, which the events it captures get. */
  withScope<T>(callback: (scope: Scope) => T): T;
  /** Runs `callback` with a copy of the scope as the isolation scope of what it runs. */
  withIsolationScope<T>(callback: (scope: Scope) => T): T;
  /** The id of the last event captured. */
  lastEventId(): string | undefined;
  /** Sends the counts of dropped events as a client report, when there are any. */
  sendClientReport(): void;
  /** Sends the envelopes waiting for a retry now. */
  retryQueued(): Promise<void>;
  /** Stops retrying the envelopes waiting in the store; they stay there. */
  stopRetries(): void;
  /** Resolves once everything captured so far was sent or dropped. */
  flush(): Promise<void>;
}

/** What makes two events the same for the dedupe: messages and the frames that threw. */
function signatureOf(event: ProbaraEvent): string {
  return JSON.stringify([
    event.message,
    event.exception?.values.map((value) => [
      value.type,
      value.value,
      value.stacktrace?.frames.map((frame) => [
        frame.filename,
        frame.function,
        frame.lineno,
        frame.colno,
      ]),
    ]),
  ]);
}

function replayRequested(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const { id, replay } = body as { id?: unknown; replay?: unknown };
  return replay === 'requested' && typeof id === 'string' ? id : null;
}

function withoutPii(user: User): User {
  const out: User = { ...user };
  delete out.email;
  delete out.ip_address;
  return out;
}

function callerFrames(synthetic: Error | undefined) {
  if (typeof synthetic?.stack !== 'string') return [];
  return parseStackTrace(synthetic.stack).slice(0, -1);
}

/** A client for `options.dsn`; `null` when the DSN cannot be read, so the SDK stays off. */
export function createClient(options: ClientOptions): Client | null {
  const dsn = parseDsn(options.dsn);
  if (dsn === null) return null;
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const scrub = options.scrub ?? ((text: string) => text);
  const log = options.log ?? (() => undefined);
  const maxBreadcrumbs = Math.max(0, options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS);
  const normalizeDepth = options.normalizeDepth ?? DEFAULT_NORMALIZE_DEPTH;
  const ignoreErrors = [...DEFAULT_IGNORE_ERRORS, ...(options.ignoreErrors ?? [])];
  const denyUrls = [...DEFAULT_DENY_URLS, ...(options.denyUrls ?? [])];
  const root = new Scope(options.initialScope);
  const isolationOf = new WeakMap<Scope, Scope>([[root, root]]);
  let current = root;
  const scopeNow = (): Scope => options.isolation?.get() ?? current;
  const isolationNow = (): Scope => {
    const scope = scopeNow();
    return isolationOf.get(scope) ?? scope;
  };
  const maxEvents = options.maxEventsPerMinute ?? RATE_LIMIT_EVENTS;
  const captured = new WeakSet<object>();
  const discarded = new Map<string, DiscardedEvents>();
  let previous: string | undefined;
  let lastEventId: string | undefined;
  const sentAt: number[] = [];
  const pending = new Set<Promise<void>>();

  function record(reason: DiscardReason, category: DataCategory, quantity = 1): void {
    log(`Dropped ${String(quantity)} ${category} (${reason})`);
    if (options.sendClientReports === false) return;
    const key = `${reason}:${category}`;
    const entry = discarded.get(key);
    if (entry === undefined) discarded.set(key, { reason, category, quantity });
    else entry.quantity += quantity;
  }

  const transport = createTransport({
    request: (body) => options.send(body),
    record,
    store: options.store ?? createMemoryStore(),
    schedule: options.schedule ?? defaultSchedule,
    now,
    random,
    ...(options.isOnline === undefined ? {} : { isOnline: options.isOnline }),
  });

  function envelopeHeader(eventId?: string): Record<string, unknown> {
    return {
      ...(eventId === undefined ? {} : { event_id: eventId }),
      sent_at: new Date(now()).toISOString(),
      sdk: options.sdk,
      ...(options.tunnel === undefined ? {} : { dsn: options.dsn }),
    };
  }

  function track(work: Promise<unknown>): void {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    pending.add(settled);
    void settled.finally(() => pending.delete(settled));
  }

  function filtered(event: ProbaraEvent): boolean {
    if (messagesOf(event).some((message) => matches(message, ignoreErrors))) return true;
    const url = urlOf(event);
    if (url === undefined) return false;
    if (matches(url, denyUrls)) return true;
    return (
      options.allowUrls !== undefined &&
      options.allowUrls.length > 0 &&
      !matches(url, options.allowUrls)
    );
  }

  function rateLimited(at: number): boolean {
    while (sentAt.length > 0 && (sentAt[0] ?? 0) <= at - RATE_LIMIT_WINDOW_MS) sentAt.shift();
    if (sentAt.length >= maxEvents) return true;
    sentAt.push(at);
    return false;
  }

  function cleaned(text: string): string {
    return truncate(scrub(text), options.maxValueLength);
  }

  function normalized(event: ProbaraEvent): ProbaraEvent {
    if (normalizeDepth <= 0) return event;
    const out = { ...event };
    if (out.extra !== undefined)
      out.extra = normalize(out.extra, normalizeDepth) as Record<string, unknown>;
    if (out.contexts !== undefined) {
      out.contexts = normalize(out.contexts, normalizeDepth) as Record<
        string,
        Record<string, unknown>
      >;
    }
    if (out.user !== undefined) out.user = normalize(out.user, normalizeDepth) as User;
    if (out.breadcrumbs !== undefined) {
      out.breadcrumbs = {
        values: out.breadcrumbs.values.map((crumb) =>
          crumb.data === undefined
            ? crumb
            : { ...crumb, data: normalize(crumb.data, normalizeDepth) as Record<string, unknown> },
        ),
      };
    }
    return out;
  }

  function scrubbed(event: ProbaraEvent): ProbaraEvent {
    const out = { ...event };
    if (out.message !== undefined) out.message = cleaned(out.message);
    if (out.exception !== undefined) {
      out.exception = {
        values: out.exception.values.map((value) =>
          value.value === undefined ? value : { ...value, value: cleaned(value.value) },
        ),
      };
    }
    if (out.breadcrumbs !== undefined) {
      out.breadcrumbs = {
        values: out.breadcrumbs.values.map((crumb) =>
          crumb.message === undefined ? crumb : { ...crumb, message: cleaned(crumb.message) },
        ),
      };
    }
    if (out.request?.url !== undefined) {
      out.request = { ...out.request, url: truncate(out.request.url, options.maxValueLength) };
    }
    if (out.user !== undefined && options.sendDefaultPii !== true) out.user = withoutPii(out.user);
    return out;
  }

  async function deliver(event: ProbaraEvent, eventId: string): Promise<void> {
    const response = await transport.send(envelopeHeader(eventId), [
      { header: { type: 'event' }, payload: JSON.stringify(event) },
    ]);
    if (response === undefined || response.status < 200 || response.status >= 300) return;
    const requested = replayRequested(response.body);
    const replay = options.replay;
    if (requested === null || replay === undefined || replay.alreadySent()) return;
    replay.markSent();
    const bytes = await replay.take(requested);
    if (bytes === null || bytes.length === 0) return;
    await transport.send(envelopeHeader(requested), [
      { header: { type: 'replay', content_type: 'application/gzip' }, payload: bytes },
    ]);
  }

  function process(input: ProbaraEvent, hint: EventHint, scope: Scope): string {
    const eventId = input.event_id ?? randomId();
    lastEventId = eventId;
    try {
      const at = now();
      let event: ProbaraEvent = {
        level: 'error',
        ...input,
        event_id: eventId,
        timestamp: input.timestamp ?? at / 1000,
        platform: options.platform,
        sdk: options.sdk,
      };
      if (options.release !== undefined) event.release ??= options.release;
      if (options.dist !== undefined) event.dist ??= options.dist;
      if (options.environment !== undefined) event.environment ??= options.environment;
      event = scope.applyTo(event);
      if (options.enrich !== undefined) event = options.enrich(event);
      event = withDebugImages(event);
      event = scrubbed(normalized(event));
      if (filtered(event)) {
        record('event_processor', 'error');
        return eventId;
      }
      if (options.sampleRate !== undefined && random() >= options.sampleRate) {
        record('sample_rate', 'error');
        return eventId;
      }
      const signature = signatureOf(event);
      if (signature === previous) {
        record('event_processor', 'error');
        return eventId;
      }
      if (options.beforeSend !== undefined) {
        let changed: ProbaraEvent | null;
        try {
          changed = options.beforeSend(event, hint);
        } catch {
          changed = null;
        }
        if (changed === null) {
          record('before_send', 'error');
          return eventId;
        }
        event = changed;
      }
      previous = signature;
      if (rateLimited(at)) {
        record('ratelimit_backoff', 'error');
        return eventId;
      }
      track(deliver(event, eventId));
    } catch {
      record('internal_sdk_error', 'error');
    }
    return eventId;
  }

  function withStack(values: ExceptionValue[], hint: EventHint): ExceptionValue[] {
    if (options.attachStacktrace !== true) return values;
    const [first, ...rest] = values;
    if (first === undefined || first.stacktrace !== undefined) return values;
    const frames = callerFrames(hint.syntheticException);
    return frames.length === 0 ? values : [{ ...first, stacktrace: { frames } }, ...rest];
  }

  function stackOf(hint: EventHint | undefined, synthetic: Error | undefined): EventHint {
    if (hint?.syntheticException !== undefined || synthetic === undefined) return hint ?? {};
    return { ...hint, syntheticException: synthetic };
  }

  const client: Client = {
    dsn,
    get scope() {
      return scopeNow();
    },
    get isolationScope() {
      return isolationNow();
    },
    captureException(exception, given) {
      if (typeof exception === 'object' && exception !== null) {
        if (captured.has(exception)) return '';
        captured.add(exception);
      }
      const hint = stackOf(given, options.attachStacktrace === true ? new Error() : undefined);
      const mechanism = hint.mechanism ?? { type: 'generic', handled: true };
      let values;
      try {
        values = withStack(exceptionValues(exception, mechanism), hint);
      } catch {
        values = [{ type: 'Error', value: 'Unreadable exception', mechanism }];
      }
      return process(
        { level: 'error', exception: { values } },
        { ...hint, originalException: exception, mechanism },
        scopeNow(),
      );
    },
    captureMessage(message, level = 'info', given) {
      const hint = stackOf(given, options.attachStacktrace === true ? new Error() : undefined);
      const frames = options.attachStacktrace === true ? callerFrames(hint.syntheticException) : [];
      const event: ProbaraEvent = { message, level };
      if (frames.length > 0) {
        event.exception = {
          values: [
            {
              value: message,
              stacktrace: { frames },
              mechanism: { type: 'generic', handled: true, synthetic: true },
            },
          ],
        };
      }
      return process(event, hint, scopeNow());
    },
    captureEvent(event, hint = {}) {
      return process(event, hint, scopeNow());
    },
    addBreadcrumb(breadcrumb, hint) {
      try {
        let crumb: Breadcrumb | null = { timestamp: now() / 1000, ...breadcrumb };
        if (options.beforeBreadcrumb !== undefined) crumb = options.beforeBreadcrumb(crumb, hint);
        if (crumb !== null && maxBreadcrumbs > 0) scopeNow().addBreadcrumb(crumb, maxBreadcrumbs);
      } catch {
        // A failing beforeBreadcrumb drops the breadcrumb.
      }
    },
    withScope(callback) {
      const parent = scopeNow();
      const forked = parent.clone();
      isolationOf.set(forked, isolationOf.get(parent) ?? parent);
      return runIn(forked, callback);
    },
    withIsolationScope(callback) {
      const forked = scopeNow().clone();
      isolationOf.set(forked, forked);
      return runIn(forked, callback);
    },
    lastEventId: () => lastEventId,
    sendClientReport() {
      if (options.sendClientReports === false || discarded.size === 0) return;
      const discardedEvents = [...discarded.values()];
      discarded.clear();
      const item: EnvelopeItem = {
        header: { type: 'client_report' },
        payload: JSON.stringify({ timestamp: now() / 1000, discarded_events: discardedEvents }),
      };
      track(transport.send(envelopeHeader(), [item]));
    },
    retryQueued: () => transport.drain(),
    stopRetries() {
      transport.stop();
    },
    async flush() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };

  function runIn<T>(forked: Scope, callback: (scope: Scope) => T): T {
    const isolation = options.isolation;
    if (isolation !== undefined) return isolation.run(forked, () => callback(forked));
    const outer = current;
    current = forked;
    try {
      return callback(forked);
    } finally {
      current = outer;
    }
  }

  return client;
}
