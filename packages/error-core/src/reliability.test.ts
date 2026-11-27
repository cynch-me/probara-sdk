import { describe, expect, it } from 'vitest';
import {
  Scope,
  createClient,
  createMemoryStore,
  parseRateLimits,
  type ClientOptions,
  type ProbaraEvent,
  type TransportResponse,
} from './index.js';

const DSN = 'https://pek_test@ingest.probara.test/';

interface Sent {
  header: Record<string, unknown>;
  items: { header: Record<string, unknown>; payload: Uint8Array }[];
}

function decode(body: Uint8Array): Sent {
  const text = new TextDecoder();
  const lineAt = (offset: number) => {
    const end = body.indexOf(10, offset);
    return end === -1
      ? { line: body.subarray(offset), next: body.length }
      : { line: body.subarray(offset, end), next: end + 1 };
  };
  const first = lineAt(0);
  const header = JSON.parse(text.decode(first.line)) as Record<string, unknown>;
  const items: Sent['items'] = [];
  let offset = first.next;
  while (offset < body.length) {
    const head = lineAt(offset);
    const itemHeader = JSON.parse(text.decode(head.line)) as Record<string, unknown>;
    const length = itemHeader['length'] as number;
    items.push({ header: itemHeader, payload: body.subarray(head.next, head.next + length) });
    offset = head.next + length + 1;
  }
  return { header, items };
}

const json = (payload: Uint8Array | undefined): unknown =>
  JSON.parse(new TextDecoder().decode(payload));

type Answer = TransportResponse | 'network-error';

function setUp(options: Partial<ClientOptions> = {}, respond?: (sent: Sent) => Answer) {
  const sent: Sent[] = [];
  const timers: { ms: number; run: () => void }[] = [];
  let now = 1_700_000_000_000;
  const client = createClient({
    dsn: DSN,
    platform: 'browser',
    sdk: { name: 'probara.javascript.test', version: '1.2.3' },
    send: (body) => {
      const envelope = decode(body);
      sent.push(envelope);
      const answer = respond?.(envelope) ?? { status: 200, body: { id: 'x', replay: 'skip' } };
      return answer === 'network-error'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(answer);
    },
    now: () => now,
    random: () => 0.5,
    schedule: (run, ms) => {
      const timer = { ms, run };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    ...options,
  });
  if (client === null) throw new Error('no client');
  const typed = (type: string) =>
    sent.filter((envelope) => envelope.items.some((item) => item.header['type'] === type));
  return {
    client,
    sent,
    timers,
    events: () =>
      typed('event').map((envelope) => json(envelope.items[0]?.payload) as ProbaraEvent),
    reports: () =>
      typed('client_report').map(
        (envelope) =>
          json(envelope.items.find((item) => item.header['type'] === 'client_report')?.payload) as {
            timestamp: number;
            discarded_events: { reason: string; category: string; quantity: number }[];
          },
      ),
    advance: (ms: number) => {
      now += ms;
    },
    runTimers: async () => {
      for (const timer of timers.splice(0)) timer.run();
      await client.flush();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await client.flush();
    },
  };
}

describe('the rate limits header', () => {
  it('reads retry-after seconds, categories (empty for all), scope and reason, comma-separated', () => {
    expect(parseRateLimits('60:error;replay:key:quota, 5::organization', 1000)).toEqual({
      error: 61_000,
      replay: 61_000,
      all: 6000,
    });
    expect(parseRateLimits('x:error:key', 0)).toEqual({ error: 60_000 });
  });
});

describe('the transport of the error client', () => {
  it('stops sending the categories X-Probara-Rate-Limits names until their time passed, recording ratelimit_backoff', async () => {
    let first = true;
    const { client, events, reports, advance } = setUp({}, () => {
      if (!first) return { status: 200 };
      first = false;
      return { status: 200, rateLimits: '30:error:key:quota_exceeded' };
    });
    client.captureMessage('first');
    await client.flush();
    client.captureMessage('limited');
    await client.flush();
    expect(events().map((event) => event.message)).toEqual(['first']);
    client.sendClientReport();
    await client.flush();
    expect(reports().at(-1)?.discarded_events).toEqual([
      { reason: 'ratelimit_backoff', category: 'error', quantity: 1 },
    ]);
    advance(30_001);
    client.captureMessage('after');
    await client.flush();
    expect(events().map((event) => event.message)).toEqual(['first', 'after']);
  });

  it('limits every category for a rate limit entry without categories', async () => {
    let calls = 0;
    const { client, sent } = setUp({}, () => {
      calls += 1;
      return calls === 1 ? { status: 429, rateLimits: '60::organization' } : { status: 200 };
    });
    client.captureMessage('first');
    await client.flush();
    client.captureMessage('second');
    client.sendClientReport();
    await client.flush();
    expect(sent).toHaveLength(1);
  });

  it('retries a network error with exponential backoff and jitter, then sends it', async () => {
    let failures = 2;
    const { client, events, timers, runTimers } = setUp({}, () => {
      if (failures > 0) {
        failures -= 1;
        return 'network-error';
      }
      return { status: 200 };
    });
    client.captureMessage('flaky');
    await client.flush();
    expect(timers.map((timer) => timer.ms)).toEqual([750]);
    await runTimers();
    expect(timers.map((timer) => timer.ms)).toEqual([1500]);
    await runTimers();
    expect(events().map((event) => event.message)).toEqual(['flaky', 'flaky', 'flaky']);
    expect(timers).toEqual([]);
  });

  it('retries a 5xx but never a 4xx, and gives up after the last attempt with send_error', async () => {
    const { client, sent, timers, runTimers, reports } = setUp({}, (envelope) =>
      envelope.items[0]?.header['type'] === 'client_report' ? { status: 200 } : { status: 503 },
    );
    client.captureMessage('down');
    await client.flush();
    for (let attempt = 0; attempt < 10 && timers.length > 0; attempt += 1) await runTimers();
    expect(sent).toHaveLength(5);
    const bad = setUp({}, () => ({ status: 400 }));
    bad.client.captureMessage('bad');
    await bad.client.flush();
    expect(bad.timers).toEqual([]);
    expect(bad.sent).toHaveLength(1);
    client.sendClientReport();
    await client.flush();
    expect(reports().at(-1)?.discarded_events).toEqual([
      { reason: 'send_error', category: 'error', quantity: 1 },
    ]);
  });

  it('keeps failed envelopes in a bounded queue, recording cache_overflow beyond it', async () => {
    let online = false;
    const { client, events, reports } = setUp(
      { store: createMemoryStore({ maxEnvelopes: 2, maxBytes: 1_000_000 }) },
      (envelope) =>
        !online && envelope.items[0]?.header['type'] === 'event'
          ? 'network-error'
          : { status: 200 },
    );
    for (const message of ['a', 'b', 'c']) client.captureMessage(message);
    await client.flush();
    online = true;
    await client.retryQueued();
    await client.flush();
    expect(
      events()
        .map((event) => event.message)
        .slice(3),
    ).toEqual(['a', 'b']);
    client.sendClientReport();
    await client.flush();
    expect(reports().at(-1)?.discarded_events).toEqual([
      { reason: 'cache_overflow', category: 'error', quantity: 1 },
    ]);
  });

  it('sends discarded events as a client_report item with reason, category and quantity', async () => {
    const { client, reports, sent } = setUp({
      sampleRate: 0.4,
      ignoreErrors: ['noise'],
    });
    client.captureMessage('sampled out');
    client.captureMessage('also sampled out');
    await client.flush();
    client.sendClientReport();
    await client.flush();
    const envelope = sent.at(-1);
    expect(envelope?.items.map((item) => item.header['type'])).toEqual(['client_report']);
    expect(envelope?.header['event_id']).toBeUndefined();
    expect(reports()[0]).toEqual({
      timestamp: 1_700_000_000,
      discarded_events: [{ reason: 'sample_rate', category: 'error', quantity: 2 }],
    });
    client.sendClientReport();
    await client.flush();
    expect(reports()).toHaveLength(1);
  });

  it('records event_processor, before_send and ratelimit_backoff drops, and no reports when sendClientReports is false', async () => {
    const { client, reports } = setUp({
      ignoreErrors: ['noise'],
      beforeSend: (event) => (event.message === 'drop' ? null : event),
      maxEventsPerMinute: 1,
    });
    client.captureMessage('noise');
    client.captureMessage('drop');
    client.captureMessage('kept');
    client.captureMessage('over the limit');
    await client.flush();
    client.sendClientReport();
    await client.flush();
    expect(reports()[0]?.discarded_events).toEqual([
      { reason: 'event_processor', category: 'error', quantity: 1 },
      { reason: 'before_send', category: 'error', quantity: 1 },
      { reason: 'ratelimit_backoff', category: 'error', quantity: 1 },
    ]);
    const off = setUp({ sendClientReports: false, sampleRate: 0 });
    off.client.captureMessage('sampled');
    off.client.sendClientReport();
    await off.client.flush();
    expect(off.sent).toEqual([]);
  });
});

describe('the options of the error client', () => {
  it('sets dist, and puts the DSN in the envelope header when a tunnel is used', async () => {
    const { client, sent, events } = setUp({ release: 'shop@1', dist: 'web', tunnel: '/tunnel' });
    client.captureMessage('tunneled');
    await client.flush();
    expect(events()[0]).toMatchObject({ release: 'shop@1', dist: 'web' });
    expect(sent[0]?.header['dsn']).toBe(DSN);
    const direct = setUp();
    direct.client.captureMessage('direct');
    await direct.client.flush();
    expect(direct.sent[0]?.header['dsn']).toBeUndefined();
  });

  it('sends the email and IP address of the user only with sendDefaultPii', async () => {
    const user = { id: 'u-1', email: 'a@b.test', ip_address: '1.2.3.4' };
    const off = setUp();
    off.client.scope.setUser(user);
    off.client.captureMessage('off');
    await off.client.flush();
    expect(off.events()[0]?.user).toEqual({ id: 'u-1' });
    const on = setUp({ sendDefaultPii: true });
    on.client.scope.setUser(user);
    on.client.captureMessage('on');
    await on.client.flush();
    expect(on.events()[0]?.user).toEqual(user);
  });

  it('normalizes extra, contexts, user and breadcrumb data to normalizeDepth, circular references and odd values', async () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;
    const { client, events } = setUp();
    client.scope.setExtra('deep', { a: { b: { c: { d: 1 } } } });
    client.scope.setExtra('loop', circular);
    client.scope.setExtra('odd', [undefined, Number.NaN, () => 1, 10n]);
    client.scope.setContext('nested', { a: { b: { c: 1 } }, list: [[1, [2]]] });
    client.addBreadcrumb({ message: 'm', data: { a: { b: { c: { d: 1 } } } } });
    client.captureMessage('normalized');
    await client.flush();
    const event = events()[0];
    expect(event?.extra).toEqual({
      deep: { a: { b: '[Object]' } },
      loop: { name: 'loop', self: '[Circular ~]' },
      odd: ['[undefined]', '[NaN]', '[Function: <anonymous>]', '[BigInt: 10]'],
    });
    expect(event?.contexts?.['nested']).toEqual({ a: { b: '[Object]' }, list: ['[Array]'] });
    expect(event?.breadcrumbs?.values[0]?.data).toEqual({ a: { b: { c: '[Object]' } } });
    const deeper = setUp({ normalizeDepth: 5 });
    deeper.client.scope.setExtra('deep', { a: { b: { c: { d: 1 } } } });
    deeper.client.captureMessage('deeper');
    await deeper.client.flush();
    expect(deeper.events()[0]?.extra).toEqual({ deep: { a: { b: { c: { d: 1 } } } } });
  });

  it('truncates messages, exception values, breadcrumb messages and the request URL to maxValueLength', async () => {
    const { client, events } = setUp({ maxValueLength: 5 });
    client.addBreadcrumb({ message: 'breadcrumb' });
    client.scope.setRequest({ url: 'https://shop.test/long' });
    client.captureMessage('message');
    client.captureException(new Error('exception'));
    await client.flush();
    const [message, exception] = events();
    expect(message?.message).toBe('messa...');
    expect(message?.breadcrumbs?.values[0]?.message).toBe('bread...');
    expect(message?.request?.url).toBe('https...');
    expect(exception?.exception?.values.at(-1)?.value).toBe('excep...');
    const untouched = setUp();
    untouched.client.captureMessage('a'.repeat(400));
    await untouched.client.flush();
    expect(untouched.events()[0]?.message).toHaveLength(400);
  });

  it('attaches the stack of the call to messages and non-error values with attachStacktrace', async () => {
    const { client, events } = setUp({ attachStacktrace: true });
    function fromApp(): void {
      client.captureMessage('with stack');
      client.captureException('a string');
    }
    fromApp();
    await client.flush();
    const [message, value] = events();
    expect(message?.message).toBe('with stack');
    const frames = message?.exception?.values[0]?.stacktrace?.frames ?? [];
    expect(frames.at(-1)?.function).toContain('fromApp');
    expect(message?.exception?.values[0]).toMatchObject({
      value: 'with stack',
      mechanism: { synthetic: true },
    });
    expect(value?.exception?.values[0]?.stacktrace?.frames.at(-1)?.function).toContain('fromApp');
    const plain = setUp();
    plain.client.captureMessage('no stack');
    await plain.client.flush();
    expect(plain.events()[0]?.exception).toBeUndefined();
  });

  it('logs why events are dropped through log', async () => {
    const logged: string[] = [];
    const { client } = setUp({ sampleRate: 0, log: (message) => logged.push(message) });
    client.captureMessage('sampled');
    await client.flush();
    expect(logged).toEqual([expect.stringContaining('sample_rate')]);
  });

  it('remembers the id of the last event captured', () => {
    const { client } = setUp();
    expect(client.lastEventId()).toBeUndefined();
    const id = client.captureMessage('one');
    expect(client.lastEventId()).toBe(id);
  });

  it('captures the same error object once, however many times it is handed over', async () => {
    const { client, events } = setUp();
    const error = new Error('twice');
    const first = client.captureException(error, {
      mechanism: { type: 'instrument', handled: false },
    });
    const second = client.captureException(error, {
      mechanism: { type: 'onerror', handled: false },
    });
    await client.flush();
    expect(first).not.toBe('');
    expect(second).toBe('');
    expect(events()).toHaveLength(1);
  });

  it('keeps an isolation scope apart from the scopes withScope forks', async () => {
    const { client, events } = setUp();
    client.isolationScope.setTag('page', 'checkout');
    client.withScope((scope) => {
      expect(client.scope).toBe(scope);
      expect(client.isolationScope).not.toBe(scope);
      client.captureMessage('inner');
    });
    client.withIsolationScope((scope) => {
      expect(client.isolationScope).toBe(scope);
      scope.setTag('request', 'r1');
      client.captureMessage('isolated');
    });
    client.captureMessage('outer');
    await client.flush();
    expect(events().map((event) => event.tags)).toEqual([
      { page: 'checkout' },
      { page: 'checkout', request: 'r1' },
      { page: 'checkout' },
    ]);
    expect(new Scope().setExtras({ a: 1, b: 2 })).toBeInstanceOf(Scope);
  });
});
