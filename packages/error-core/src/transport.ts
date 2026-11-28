import { serializeEnvelope, type EnvelopeItem } from './envelope.js';

export type DataCategory = 'error' | 'replay' | 'client_report';

export type DiscardReason =
  | 'queue_overflow'
  | 'cache_overflow'
  | 'ratelimit_backoff'
  | 'network_error'
  | 'sample_rate'
  | 'before_send'
  | 'event_processor'
  | 'send_error'
  | 'internal_sdk_error';

export interface DiscardedEvents {
  reason: DiscardReason;
  category: DataCategory;
  quantity: number;
}

export interface TransportResponse {
  status: number;
  retryAfter?: string | null;
  rateLimits?: string | null;
  body?: unknown;
}

export type SendRequest = (body: Uint8Array<ArrayBuffer>) => Promise<TransportResponse>;

export interface StoredEnvelope {
  body: Uint8Array<ArrayBuffer>;
  categories: DataCategory[];
  attempts: number;
}

export interface EnvelopeStore {
  push(entry: StoredEnvelope): Promise<boolean>;
  unshift(entry: StoredEnvelope): Promise<void>;
  shift(): Promise<StoredEnvelope | undefined>;
}

export type Schedule = (callback: () => void, ms: number) => () => void;

export const MAX_IN_FLIGHT_ENVELOPES = 30;
export const MAX_SEND_ATTEMPTS = 5;
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MS = 60_000;
export const MAX_QUEUED_ENVELOPES = 30;
export const MAX_QUEUED_BYTES = 5 * 1024 * 1024;

const CATEGORY_OF_ITEM: Record<string, DataCategory> = {
  event: 'error',
  replay: 'replay',
  client_report: 'client_report',
};

export function categoryOf(itemType: string): DataCategory {
  return CATEGORY_OF_ITEM[itemType] ?? 'error';
}

export type RateLimits = Partial<Record<DataCategory | 'all', number>>;

export function parseRateLimits(header: string, now: number): RateLimits {
  const limits: RateLimits = {};
  const extend = (category: DataCategory | 'all', until: number): void => {
    limits[category] = Math.max(limits[category] ?? 0, until);
  };
  for (const entry of header.split(',')) {
    const [retryAfter = '', categories = ''] = entry.trim().split(':');
    const seconds = Number.parseInt(retryAfter, 10);
    const until = now + (Number.isNaN(seconds) ? DEFAULT_RATE_LIMIT_MS : seconds * 1000);
    if (categories.trim() === '') {
      extend('all', until);
      continue;
    }
    for (const category of categories.split(';')) {
      const name = category.trim();
      if (name === 'error' || name === 'replay' || name === 'client_report') extend(name, until);
    }
  }
  return limits;
}

export function retryAfterMs(value: string | null | undefined, now: number): number {
  if (value === null || value === undefined || value.trim() === '') return DEFAULT_RATE_LIMIT_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? DEFAULT_RATE_LIMIT_MS : Math.max(0, date - now);
}

export function createMemoryStore(
  limits: { maxEnvelopes?: number; maxBytes?: number } = {},
): EnvelopeStore {
  const maxEnvelopes = limits.maxEnvelopes ?? MAX_QUEUED_ENVELOPES;
  const maxBytes = limits.maxBytes ?? MAX_QUEUED_BYTES;
  const entries: StoredEnvelope[] = [];
  const bytes = (): number => entries.reduce((sum, entry) => sum + entry.body.length, 0);
  return {
    push(entry) {
      if (entries.length >= maxEnvelopes || bytes() + entry.body.length > maxBytes) {
        return Promise.resolve(false);
      }
      entries.push(entry);
      return Promise.resolve(true);
    },
    unshift(entry) {
      entries.unshift(entry);
      return Promise.resolve();
    },
    shift: () => Promise.resolve(entries.shift()),
  };
}

interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

export function defaultSchedule(callback: () => void, ms: number): () => void {
  const timers = globalThis as unknown as Timers;
  const timer = timers.setTimeout(callback, ms);
  (timer as { unref?: () => void } | null)?.unref?.();
  return () => {
    timers.clearTimeout(timer);
  };
}

export interface TransportOptions {
  request: SendRequest;
  record: (reason: DiscardReason, category: DataCategory, quantity?: number) => void;
  store: EnvelopeStore;
  schedule: Schedule;
  now: () => number;
  random: () => number;
  isOnline?: () => boolean;
}

export interface Transport {
  send(
    header: Record<string, unknown>,
    items: readonly EnvelopeItem[],
  ): Promise<TransportResponse | undefined>;
  drain(): Promise<void>;
  isLimited(category: DataCategory): boolean;
  stop(): void;
}

type Outcome = { kind: 'sent'; response: TransportResponse } | { kind: 'failed'; network: boolean };

export function createTransport(options: TransportOptions): Transport {
  let limits: RateLimits = {};
  let inFlight = 0;
  let failures = 0;
  let cancelDrain: (() => void) | undefined;
  let draining: Promise<void> | undefined;
  let stopped = false;

  function isLimited(category: DataCategory): boolean {
    const until = Math.max(limits[category] ?? 0, limits.all ?? 0);
    return until > options.now();
  }

  function updateLimits(response: TransportResponse): void {
    const now = options.now();
    let next: RateLimits | undefined;
    if (typeof response.rateLimits === 'string' && response.rateLimits.trim() !== '') {
      next = parseRateLimits(response.rateLimits, now);
    } else if (response.status === 429) {
      next = { all: now + retryAfterMs(response.retryAfter, now) };
    }
    if (next === undefined) return;
    const merged: RateLimits = { ...limits };
    for (const [category, until] of Object.entries(next) as [keyof RateLimits, number][]) {
      merged[category] = Math.max(merged[category] ?? 0, until);
    }
    limits = merged;
  }

  function recordAll(reason: DiscardReason, categories: readonly DataCategory[]): void {
    if (categories.includes('client_report')) return;
    for (const category of categories) options.record(reason, category);
  }

  async function attempt(entry: StoredEnvelope): Promise<Outcome> {
    let response: TransportResponse;
    try {
      response = await options.request(entry.body);
    } catch {
      return { kind: 'failed', network: true };
    }
    updateLimits(response);
    if (response.status >= 500) return { kind: 'failed', network: false };
    if (response.status === 413) recordAll('send_error', entry.categories);
    return { kind: 'sent', response };
  }

  function backoff(): number {
    const exponential = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** failures);
    return Math.round(exponential / 2 + (exponential / 2) * options.random());
  }

  function scheduleDrain(ms: number): void {
    if (stopped || cancelDrain !== undefined) return;
    cancelDrain = options.schedule(() => {
      cancelDrain = undefined;
      void drain();
    }, ms);
  }

  async function keep(entry: StoredEnvelope, network: boolean, first: boolean): Promise<void> {
    entry.attempts += 1;
    if (entry.categories.includes('client_report')) return;
    if (entry.attempts >= MAX_SEND_ATTEMPTS) {
      recordAll(network ? 'network_error' : 'send_error', entry.categories);
      return;
    }
    if (first) {
      const stored = await options.store.push(entry).catch(() => false);
      if (!stored) {
        recordAll('cache_overflow', entry.categories);
        return;
      }
    } else {
      await options.store.unshift(entry).catch(() => undefined);
    }
    scheduleDrain(backoff());
    failures += 1;
  }

  async function drainOnce(): Promise<void> {
    for (;;) {
      if (options.isOnline?.() === false) return;
      const entry = await options.store.shift().catch(() => undefined);
      if (entry === undefined) {
        failures = 0;
        return;
      }
      if (entry.categories.some(isLimited)) {
        await options.store.unshift(entry).catch(() => undefined);
        scheduleDrain(DEFAULT_RATE_LIMIT_MS);
        return;
      }
      const outcome = await attempt(entry);
      if (outcome.kind === 'failed') {
        await keep(entry, outcome.network, false);
        return;
      }
      failures = 0;
    }
  }

  function drain(): Promise<void> {
    cancelDrain?.();
    cancelDrain = undefined;
    draining ??= drainOnce().finally(() => {
      draining = undefined;
    });
    return draining;
  }

  return {
    isLimited,
    drain,
    stop() {
      stopped = true;
      cancelDrain?.();
      cancelDrain = undefined;
    },
    async send(header, items) {
      const kept: EnvelopeItem[] = [];
      for (const item of items) {
        const category = categoryOf(item.header.type);
        if (isLimited(category)) {
          if (category !== 'client_report') options.record('ratelimit_backoff', category);
        } else {
          kept.push(item);
        }
      }
      if (kept.length === 0) return undefined;
      const categories = kept.map((item) => categoryOf(item.header.type));
      if (inFlight >= MAX_IN_FLIGHT_ENVELOPES) {
        recordAll('queue_overflow', categories);
        return undefined;
      }
      const entry: StoredEnvelope = {
        body: serializeEnvelope(header, kept),
        categories,
        attempts: 0,
      };
      if (options.isOnline?.() === false) {
        await keep(entry, true, true);
        return undefined;
      }
      inFlight += 1;
      try {
        const outcome = await attempt(entry);
        if (outcome.kind === 'sent') return outcome.response;
        await keep(entry, outcome.network, true);
        return undefined;
      } finally {
        inFlight -= 1;
      }
    },
  };
}
