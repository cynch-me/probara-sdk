/**
 * The error client: captures errors and messages into events with the scope added, filters them on
 * the client as the SDK options say, and sends them as envelopes, silently: a failure never
 * reaches the app. When the server asks for a replay of an event, it uploads one, once per session.
 */
import { parseDsn, type Dsn } from './dsn.js';
import { serializeEnvelope } from './envelope.js';
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
import { Scope, type ScopeData } from './scope.js';
import type { Breadcrumb, EventHint, Level, Platform, ProbaraEvent } from './types.js';

/** Breadcrumbs kept unless `maxBreadcrumbs` says otherwise. */
export const DEFAULT_MAX_BREADCRUMBS = 100;

/** The most events sent in `RATE_LIMIT_WINDOW_MS`; the others are dropped. */
export const RATE_LIMIT_EVENTS = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** How long sending pauses after a `429` without a readable `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

/** What the transport got back: the status, its `Retry-After` header and the JSON body. */
export interface TransportResponse {
  status: number;
  retryAfter?: string | null;
  body?: unknown;
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
  sdk: { name: string; version: string };
  /** Sends an envelope; resolves what came back, or rejects when nothing did. */
  send: (body: Uint8Array<ArrayBuffer>) => Promise<TransportResponse>;
  release?: string;
  environment?: string;
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
  /** Removes secrets from text: messages, exception values and breadcrumb messages. */
  scrub?: (text: string) => string;
  /** Adds what the platform knows (contexts, request) to each event. */
  enrich?: (event: ProbaraEvent) => ProbaraEvent;
  replay?: ReplayProvider;
  now?: () => number;
  random?: () => number;
}

export interface Client {
  readonly dsn: Dsn;
  /** The scope of the events captured outside `withScope`. */
  readonly scope: Scope;
  captureException(exception: unknown, hint?: EventHint): string;
  captureMessage(message: string, level?: Level): string;
  captureEvent(event: ProbaraEvent, hint?: EventHint): string;
  addBreadcrumb(breadcrumb: Breadcrumb, hint?: unknown): void;
  /** Runs `callback` with a copy of the scope, which the events it captures get. */
  withScope<T>(callback: (scope: Scope) => T): T;
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

/** Milliseconds to wait from a `Retry-After` value: seconds or an HTTP date. */
function retryAfterMs(value: string | null | undefined, now: number): number {
  if (value === null || value === undefined || value.trim() === '') return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, date - now);
}

function replayRequested(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const { id, replay } = body as { id?: unknown; replay?: unknown };
  return replay === 'requested' && typeof id === 'string' ? id : null;
}

/** A client for `options.dsn`; `null` when the DSN cannot be read, so the SDK stays off. */
export function createClient(options: ClientOptions): Client | null {
  const dsn = parseDsn(options.dsn);
  if (dsn === null) return null;
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const scrub = options.scrub ?? ((text: string) => text);
  const maxBreadcrumbs = Math.max(0, options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS);
  const ignoreErrors = [...DEFAULT_IGNORE_ERRORS, ...(options.ignoreErrors ?? [])];
  const denyUrls = [...DEFAULT_DENY_URLS, ...(options.denyUrls ?? [])];
  const root = new Scope(options.initialScope);
  let current = root;
  let previous: string | undefined;
  let pausedUntil = 0;
  const sentAt: number[] = [];
  const pending = new Set<Promise<void>>();

  function track(work: Promise<void>): void {
    const settled = work.catch(() => undefined);
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
    if (sentAt.length >= RATE_LIMIT_EVENTS) return true;
    sentAt.push(at);
    return false;
  }

  function scrubbed(event: ProbaraEvent): ProbaraEvent {
    const out = { ...event };
    if (out.message !== undefined) out.message = scrub(out.message);
    if (out.exception !== undefined) {
      out.exception = {
        values: out.exception.values.map((value) =>
          value.value === undefined ? value : { ...value, value: scrub(value.value) },
        ),
      };
    }
    if (out.breadcrumbs !== undefined) {
      out.breadcrumbs = {
        values: out.breadcrumbs.values.map((crumb) =>
          crumb.message === undefined ? crumb : { ...crumb, message: scrub(crumb.message) },
        ),
      };
    }
    return out;
  }

  async function deliver(event: ProbaraEvent, eventId: string): Promise<void> {
    const envelope = serializeEnvelope(
      { event_id: eventId, sent_at: new Date(now()).toISOString(), sdk: options.sdk },
      [{ header: { type: 'event' }, payload: JSON.stringify(event) }],
    );
    const response = await options.send(envelope);
    if (response.status === 429) {
      pausedUntil = now() + retryAfterMs(response.retryAfter, now());
      return;
    }
    if (response.status < 200 || response.status >= 300) return;
    const requested = replayRequested(response.body);
    const replay = options.replay;
    if (requested === null || replay === undefined || replay.alreadySent()) return;
    replay.markSent();
    const bytes = await replay.take(requested);
    if (bytes === null || bytes.length === 0) return;
    await options.send(
      serializeEnvelope(
        { event_id: requested, sent_at: new Date(now()).toISOString(), sdk: options.sdk },
        [{ header: { type: 'replay', content_type: 'application/gzip' }, payload: bytes }],
      ),
    );
  }

  function process(input: ProbaraEvent, hint: EventHint, scope: Scope): string {
    const eventId = input.event_id ?? randomId();
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
      if (options.environment !== undefined) event.environment ??= options.environment;
      event = scope.applyTo(event);
      if (options.enrich !== undefined) event = options.enrich(event);
      event = scrubbed(event);
      if (filtered(event)) return eventId;
      if (options.sampleRate !== undefined && random() >= options.sampleRate) return eventId;
      const signature = signatureOf(event);
      if (signature === previous) return eventId;
      if (options.beforeSend !== undefined) {
        let changed: ProbaraEvent | null;
        try {
          changed = options.beforeSend(event, hint);
        } catch {
          changed = null;
        }
        if (changed === null) return eventId;
        event = changed;
      }
      previous = signature;
      if (at < pausedUntil || rateLimited(at)) return eventId;
      track(deliver(event, eventId));
    } catch {
      // Capturing never breaks the app.
    }
    return eventId;
  }

  return {
    dsn,
    get scope() {
      return current;
    },
    captureException(exception, hint = {}) {
      const mechanism = hint.mechanism ?? { type: 'generic', handled: true };
      let values;
      try {
        values = exceptionValues(exception, mechanism);
      } catch {
        values = [{ type: 'Error', value: 'Unreadable exception', mechanism }];
      }
      return process(
        { level: 'error', exception: { values } },
        { ...hint, originalException: exception, mechanism },
        current,
      );
    },
    captureMessage(message, level = 'info') {
      return process({ message, level }, {}, current);
    },
    captureEvent(event, hint = {}) {
      return process(event, hint, current);
    },
    addBreadcrumb(breadcrumb, hint) {
      try {
        let crumb: Breadcrumb | null = { timestamp: now() / 1000, ...breadcrumb };
        if (options.beforeBreadcrumb !== undefined) crumb = options.beforeBreadcrumb(crumb, hint);
        if (crumb !== null && maxBreadcrumbs > 0) current.addBreadcrumb(crumb, maxBreadcrumbs);
      } catch {
        // A failing beforeBreadcrumb drops the breadcrumb.
      }
    },
    withScope(callback) {
      const outer = current;
      current = outer.clone();
      try {
        return callback(current);
      } finally {
        current = outer;
      }
    },
    async flush() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
