import { describe, expect, it } from 'vitest';
import {
  Scope,
  createClient,
  type ClientOptions,
  type ScopeIsolation,
  type ProbaraEvent,
  type TransportResponse,
} from './index.js';

const DSN = 'https://pek_test@ingest.probara.test/';

interface Sent {
  header: Record<string, unknown>;
  items: { header: Record<string, unknown>; payload: Uint8Array }[];
}

/** Reads an envelope as the Probara ingest does: header line, then item header and payload pairs. */
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

const eventOf = (sent: Sent): ProbaraEvent =>
  JSON.parse(new TextDecoder().decode(sent.items[0]?.payload)) as ProbaraEvent;

function setUp(
  options: Partial<ClientOptions> = {},
  respond?: (body: Uint8Array) => TransportResponse,
) {
  const sent: Sent[] = [];
  let now = 1_700_000_000_000;
  const client = createClient({
    dsn: DSN,
    platform: 'node',
    sdk: { name: 'probara.javascript.test', version: '1.2.3' },
    send: (body) => {
      sent.push(decode(body));
      return Promise.resolve(respond?.(body) ?? { status: 200, body: { id: 'x', replay: 'skip' } });
    },
    now: () => now,
    random: () => 0.5,
    ...options,
  });
  if (client === null) throw new Error('no client');
  return {
    client,
    sent,
    events: () => sent.filter((s) => s.items[0]?.header['type'] === 'event').map(eventOf),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the error client', () => {
  it('is null for a DSN it cannot read, so the SDK stays off', () => {
    expect(
      createClient({
        dsn: 'nope',
        platform: 'node',
        sdk: { name: 'n', version: '1' },
        send: () => Promise.resolve({ status: 200 }),
      }),
    ).toBeNull();
  });

  it('sends a captured error as an event envelope, its length in bytes in the item header', async () => {
    const { client, sent } = setUp({ release: 'shop@1.0.0', environment: 'production' });
    const error = new TypeError('cart is undefined — ünïcode');
    const id = client.captureException(error);
    await client.flush();
    expect(sent).toHaveLength(1);
    const [envelope] = sent;
    expect(envelope?.header['event_id']).toBe(id);
    expect(envelope?.items[0]?.header).toEqual({
      type: 'event',
      length: envelope?.items[0]?.payload.length,
    });
    const event = eventOf(envelope as Sent);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(event).toMatchObject({
      event_id: id,
      platform: 'node',
      level: 'error',
      release: 'shop@1.0.0',
      environment: 'production',
      sdk: { name: 'probara.javascript.test', version: '1.2.3' },
      timestamp: 1_700_000_000,
    });
    const exception = event.exception?.values.at(-1);
    expect(exception).toMatchObject({
      type: 'TypeError',
      value: 'cart is undefined — ünïcode',
      mechanism: { type: 'generic', handled: true },
    });
    expect(exception?.stacktrace?.frames.at(-1)?.filename).toContain('client.test.ts');
  });

  it('sends the causes of an error first and the error itself last', async () => {
    const { client, events } = setUp();
    client.captureException(new Error('checkout failed', { cause: new RangeError('bad total') }));
    await client.flush();
    expect(events()[0]?.exception?.values.map((value) => [value.type, value.value])).toEqual([
      ['RangeError', 'bad total'],
      ['Error', 'checkout failed'],
    ]);
  });

  it('describes a thrown value that is not an error', async () => {
    const { client, events } = setUp();
    client.captureException({ code: 7, reason: 'x' });
    client.captureException('plain text');
    await client.flush();
    expect(events().map((event) => event.exception?.values.at(-1)?.value)).toEqual([
      'Object captured as exception with keys: code, reason',
      'plain text',
    ]);
    expect(events()[0]?.exception?.values.at(-1)?.mechanism?.synthetic).toBe(true);
  });

  it('sends a message with its level', async () => {
    const { client, events } = setUp();
    client.captureMessage('payment provider slow', 'warning');
    await client.flush();
    expect(events()[0]).toMatchObject({ message: 'payment provider slow', level: 'warning' });
  });

  it('drops an event identical to the one before it', async () => {
    const { client, events } = setUp();
    const make = (message: string) => {
      const error = new Error(message);
      error.stack = `Error: ${message}\n    at f (https://a.test/app.js:1:2)`;
      return error;
    };
    client.captureException(make('same'));
    client.captureException(make('same'));
    client.captureException(make('other'));
    client.captureException(make('same'));
    await client.flush();
    expect(events().map((event) => event.exception?.values.at(-1)?.value)).toEqual([
      'same',
      'other',
      'same',
    ]);
  });

  it('ignores ResizeObserver loops, aborts and opaque script errors by default, and the patterns given', async () => {
    const { client, events } = setUp({ ignoreErrors: [/^Flaky/, 'known noise'] });
    const abort = new Error('The user aborted a request.');
    abort.name = 'AbortError';
    client.captureMessage('ResizeObserver loop completed with undelivered notifications.');
    client.captureException(abort);
    client.captureMessage('Script error.');
    client.captureException(new Error('Flaky widget'));
    client.captureException(new Error('some known noise here'));
    client.captureException(new Error('real failure'));
    await client.flush();
    expect(events().map((event) => event.exception?.values.at(-1)?.value ?? event.message)).toEqual(
      ['real failure'],
    );
  });

  it('drops errors thrown by browser extensions, and outside allowUrls when given', async () => {
    const at = (filename: string) => {
      const error = new Error(`from ${filename}`);
      error.stack = `Error: x\n    at f (${filename}:1:2)`;
      return error;
    };
    const { client, events } = setUp({ allowUrls: ['https://shop.test'] });
    client.captureException(at('chrome-extension://abc/content.js'));
    client.captureException(at('https://cdn.other.test/lib.js'));
    client.captureException(at('https://shop.test/app.js'));
    await client.flush();
    expect(events().map((event) => event.exception?.values.at(-1)?.value)).toEqual([
      'from https://shop.test/app.js',
    ]);

    const denied = setUp({ denyUrls: [/cdn\.other/] });
    denied.client.captureException(at('https://cdn.other.test/lib.js'));
    denied.client.captureException(at('moz-extension://abc/content.js'));
    denied.client.captureException(at('https://shop.test/app.js'));
    await denied.client.flush();
    expect(denied.events()).toHaveLength(1);
  });

  it('samples events with sampleRate', async () => {
    const { client, events } = setUp({ sampleRate: 0.4 });
    client.captureException(new Error('sampled out'));
    await client.flush();
    expect(events()).toEqual([]);
    const kept = setUp({ sampleRate: 0.6 });
    kept.client.captureException(new Error('sampled in'));
    await kept.client.flush();
    expect(kept.events()).toHaveLength(1);
  });

  it('lets beforeSend change or drop an event, and drops it when beforeSend throws', async () => {
    const { client, events } = setUp({
      beforeSend: (event) => {
        const value = event.exception?.values.at(-1)?.value;
        if (value === 'drop') return null;
        if (value === 'throw') throw new Error('bug in beforeSend');
        return { ...event, tags: { ...event.tags, checked: 'yes' } };
      },
    });
    client.captureException(new Error('drop'));
    client.captureException(new Error('throw'));
    client.captureException(new Error('keep'));
    await client.flush();
    expect(
      events().map((event) => [event.exception?.values.at(-1)?.value, event.tags?.['checked']]),
    ).toEqual([['keep', 'yes']]);
  });

  it('keeps the newest maxBreadcrumbs breadcrumbs, after beforeBreadcrumb', async () => {
    const { client, events } = setUp({
      maxBreadcrumbs: 2,
      beforeBreadcrumb: (crumb) =>
        crumb.message === 'secret' ? null : { ...crumb, category: crumb.category ?? 'custom' },
    });
    for (const message of ['one', 'secret', 'two', 'three']) client.addBreadcrumb({ message });
    client.captureMessage('with crumbs');
    await client.flush();
    expect(
      events()[0]?.breadcrumbs?.values.map((crumb) => [crumb.message, crumb.category]),
    ).toEqual([
      ['two', 'custom'],
      ['three', 'custom'],
    ]);
  });

  it('sends at most 10 events a minute', async () => {
    const { client, events, advance } = setUp();
    for (let index = 0; index < 12; index += 1) client.captureMessage(`burst ${String(index)}`);
    await client.flush();
    expect(events()).toHaveLength(10);
    advance(60_001);
    client.captureMessage('after the minute');
    await client.flush();
    expect(events()).toHaveLength(11);
  });

  it('pauses silently for Retry-After after a 429', async () => {
    let limited = true;
    const { client, sent, advance } = setUp({}, () =>
      limited
        ? { status: 429, retryAfter: '30' }
        : { status: 200, body: { id: 'x', replay: 'skip' } },
    );
    client.captureMessage('limited');
    await client.flush();
    limited = false;
    client.captureMessage('while paused');
    await client.flush();
    expect(sent).toHaveLength(1);
    advance(30_001);
    client.captureMessage('after the pause');
    await client.flush();
    expect(sent).toHaveLength(2);
  });

  it('uploads one replay for an event the server asks one for, once per session', async () => {
    const taken: string[] = [];
    let sentFlag = false;
    const { client, sent } = setUp(
      {
        replay: {
          take: (eventId) => {
            taken.push(eventId);
            return Promise.resolve(new Uint8Array([0x1f, 0x8b, 0x0a, 0x00]));
          },
          alreadySent: () => sentFlag,
          markSent: () => {
            sentFlag = true;
          },
        },
      },
      (body) => ({
        status: 200,
        body: { id: decode(body).header['event_id'], replay: 'requested' },
      }),
    );
    const first = client.captureMessage('first');
    await client.flush();
    client.captureMessage('second');
    await client.flush();
    expect(taken).toEqual([first]);
    const replays = sent.filter((envelope) => envelope.items[0]?.header['type'] === 'replay');
    expect(replays).toHaveLength(1);
    expect(replays[0]?.header['event_id']).toBe(first);
    expect(replays[0]?.items[0]?.header).toMatchObject({ type: 'replay', length: 4 });
    expect([...(replays[0]?.items[0]?.payload ?? [])]).toEqual([0x1f, 0x8b, 0x0a, 0x00]);
  });

  it('uploads no replay when the server answers skip', async () => {
    const taken: string[] = [];
    const { client, sent } = setUp({
      replay: {
        take: (id) => (taken.push(id), Promise.resolve(new Uint8Array([1]))),
        alreadySent: () => false,
        markSent: () => undefined,
      },
    });
    client.captureMessage('skipped');
    await client.flush();
    expect(taken).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('applies the scope: only an opaque user, tags, contexts, extra, level and fingerprint', async () => {
    const { client, events } = setUp({ initialScope: { tags: { tenant: 'ucsf' } } });
    client.scope.setUser({
      id: 'u-1',
      username: 'alias',
      segment: 'pro',
      email: 'a@b.test',
      ip_address: '1.2.3.4',
    } as never);
    client.scope.setTags({ area: 'cart' });
    client.scope.setContext('cart', { items: 2 });
    client.scope.setExtra('attempt', 3);
    client.scope.setFingerprint(['{{ default }}', 'cart']);
    client.withScope((scope) => {
      scope.setTag('inner', 'yes');
      scope.setLevel('fatal');
      client.captureMessage('inside');
    });
    client.captureMessage('outside');
    await client.flush();
    const [inside, outside] = events();
    expect(inside).toMatchObject({
      level: 'fatal',
      user: { id: 'u-1', username: 'alias', segment: 'pro' },
      tags: { tenant: 'ucsf', area: 'cart', inner: 'yes' },
      contexts: { cart: { items: 2 } },
      extra: { attempt: 3 },
      fingerprint: ['{{ default }}', 'cart'],
    });
    expect(inside?.user).toEqual({ id: 'u-1', username: 'alias', segment: 'pro' });
    expect(outside?.tags).toEqual({ tenant: 'ucsf', area: 'cart' });
    expect(outside?.level).toBe('info');
  });

  it('scrubs messages, exception values and breadcrumb messages with the scrub hook', async () => {
    const { client, events } = setUp({ scrub: (text) => text.replaceAll('hunter2', '[x]') });
    client.addBreadcrumb({ message: 'login hunter2' });
    client.captureException(new Error('password hunter2 rejected'));
    await client.flush();
    const event = events()[0];
    expect(event?.exception?.values.at(-1)?.value).toBe('password [x] rejected');
    expect(event?.breadcrumbs?.values[0]?.message).toBe('login [x]');
  });

  it('captures with the scope the isolation hands out, so each request keeps its own', async () => {
    let active: Scope | undefined;
    const isolation: ScopeIsolation = {
      get: () => active,
      run: (scope, callback) => {
        const outer = active;
        active = scope;
        try {
          return callback();
        } finally {
          active = outer;
        }
      },
    };
    const { client, events } = setUp({ isolation });
    client.scope.setTag('global', 'yes');
    isolation.run(new Scope({ tags: { request: 'a' } }), () => {
      client.addBreadcrumb({ message: 'in request a' });
      client.scope.setUser({ id: 'u-a' });
      client.withScope((scope) => {
        expect(isolation.get()).toBe(scope);
        scope.setTag('step', 'pay');
        client.captureMessage('from a');
      });
    });
    client.captureMessage('outside');
    await client.flush();
    const [inside, outside] = events();
    expect(inside?.tags).toEqual({ request: 'a', step: 'pay' });
    expect(inside?.user).toEqual({ id: 'u-a' });
    expect(inside?.breadcrumbs?.values.map((crumb) => crumb.message)).toEqual(['in request a']);
    expect(outside?.tags).toEqual({ global: 'yes' });
    expect(outside?.user).toBeUndefined();
    expect(outside?.breadcrumbs).toBeUndefined();
  });

  it('sends up to maxEventsPerMinute events a minute when given', async () => {
    const { client, events } = setUp({ maxEventsPerMinute: 25 });
    for (let index = 0; index < 30; index += 1) client.captureMessage(`message ${String(index)}`);
    await client.flush();
    expect(events()).toHaveLength(25);
  });

  it('adds the request of the scope to its events, unless the event has its own', async () => {
    const { client, events } = setUp();
    client.scope.setRequest({ method: 'POST', url: 'https://shop.test/cart' });
    client.captureMessage('scoped');
    client.captureEvent({ message: 'own', request: { method: 'GET', url: 'https://shop.test/' } });
    await client.flush();
    expect(events().map((event) => event.request)).toEqual([
      { method: 'POST', url: 'https://shop.test/cart' },
      { method: 'GET', url: 'https://shop.test/' },
    ]);
  });
});
