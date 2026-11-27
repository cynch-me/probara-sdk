import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIngest, type FakeIngest } from '../test/ingest.js';
import * as Probara from './index.js';

let ingest: FakeIngest;
let scratch: string;

beforeEach(async () => {
  ingest = await startIngest();
  scratch = mkdtempSync(join(tmpdir(), 'probara-node-reliability-'));
});

afterEach(async () => {
  await Probara.close(1000);
  await ingest.close();
  rmSync(scratch, { recursive: true, force: true });
  delete process.env['PROBARA_RELEASE'];
  delete (globalThis as { PROBARA_RELEASE?: unknown }).PROBARA_RELEASE;
});

const init = (options: Partial<Probara.NodeOptions> = {}) => {
  Probara.init({ dsn: ingest.dsn, onUncaughtException: 'keep-alive', ...options });
};

const reports = () =>
  ingest.received
    .flatMap((entry) => entry.items)
    .filter((item) => item.header['type'] === 'client_report')
    .map((item) => JSON.parse(item.payload.toString('utf8')) as Record<string, unknown>);

describe('the options of @probara/node', () => {
  it('takes the release from the option, then PROBARA_RELEASE, then the one the bundler plugins inject', async () => {
    (globalThis as { PROBARA_RELEASE?: unknown }).PROBARA_RELEASE = { id: 'api@injected' };
    init();
    Probara.captureMessage('injected');
    await Probara.flush(2000);
    process.env['PROBARA_RELEASE'] = 'api@env';
    init();
    Probara.captureMessage('env');
    await Probara.flush(2000);
    init({ release: 'api@given' });
    Probara.captureMessage('given');
    await Probara.flush(2000);
    expect(ingest.events().map((event) => event.release)).toEqual([
      'api@injected',
      'api@env',
      'api@given',
    ]);
  });

  it('stays off with enabled: false', async () => {
    init({ enabled: false });
    expect(Probara.captureMessage('nothing')).toBe('');
    await Probara.flush(500);
    expect(ingest.received).toEqual([]);
  });

  it('posts to the tunnel with the DSN in the envelope header, and sets dist', async () => {
    init({ tunnel: `${ingest.origin}/tunnel`, dist: 'linux-x64' });
    Probara.captureMessage('tunneled');
    await Probara.flush(2000);
    expect(ingest.received.map((entry) => entry.url)).toEqual(['/tunnel']);
    expect(ingest.received[0]?.header['dsn']).toBe(ingest.dsn);
    expect(ingest.events()[0]?.dist).toBe('linux-x64');
  });

  it('sends through a custom transport, given the URL and the key header', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    init({
      transport: ({ url, headers }) => ({
        send: () => {
          calls.push({ url, headers });
          return Promise.resolve({ status: 200 });
        },
      }),
    });
    Probara.captureMessage('custom');
    await Probara.flush(2000);
    expect(ingest.received).toEqual([]);
    expect(calls).toEqual([
      {
        url: expect.stringContaining('/api/v1/public/errors/envelope') as string,
        headers: { 'probara-error-key': 'pek_test' },
      },
    ]);
  });

  it('drops errors from files outside allowUrls or inside denyUrls', async () => {
    const at = (filename: string) => {
      const error = new Error(`from ${filename}`);
      error.stack = `Error: x\n    at f (${filename}:1:2)`;
      return error;
    };
    init({ allowUrls: ['/srv/app/'], denyUrls: [/legacy/] });
    Probara.captureException(at('/srv/vendor/lib.js'));
    Probara.captureException(at('/srv/app/legacy/old.js'));
    Probara.captureException(at('/srv/app/orders.js'));
    await Probara.flush(2000);
    expect(ingest.events().map((event) => event.exception?.values.at(-1)?.value)).toEqual([
      'from /srv/app/orders.js',
    ]);
  });

  it('sends the user email, cookies and client IP headers only with sendDefaultPii', async () => {
    const app = new Hono();
    app.use(Probara.probaraHono());
    app.get('/boom', () => {
      Probara.setUser({ id: 'u-1', email: 'a@b.test' });
      throw new Error('boom');
    });
    app.onError((_error, c) => c.text('handled', 500));
    const headers = {
      cookie: 'sid=1',
      authorization: 'Bearer x',
      'x-forwarded-for': '203.0.113.9',
    };
    init();
    await app.request('http://api.test/boom', { headers });
    await Probara.flush(2000);
    init({ sendDefaultPii: true });
    await app.request('http://api.test/boom', { headers });
    await Probara.flush(2000);
    const [off, on] = ingest.events();
    expect(off?.user).toEqual({ id: 'u-1' });
    expect(off?.request?.headers).toEqual({});
    expect(on?.user).toEqual({ id: 'u-1', email: 'a@b.test' });
    expect(on?.request?.headers).toEqual({ cookie: 'sid=1', 'x-forwarded-for': '203.0.113.9' });
  });

  it('applies normalizeDepth, maxValueLength and attachStacktrace', async () => {
    init({ normalizeDepth: 1, maxValueLength: 4, attachStacktrace: true });
    Probara.setExtra('nested', { a: 1 });
    function handler(): void {
      Probara.captureMessage('truncated');
    }
    handler();
    await Probara.flush(2000);
    const [event] = ingest.events();
    expect(event).toMatchObject({ message: 'trun...', extra: { nested: '[Object]' } });
    expect(event?.exception?.values[0]?.stacktrace?.frames.at(-1)?.function).toContain('handler');
  });

  it('logs what it drops with debug', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      init({ debug: true, sampleRate: 0 });
      Probara.captureMessage('sampled');
      await Probara.flush(2000);
      expect(warn.mock.calls.flat().join(' ')).toContain('[probara]');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('the top-level API of @probara/node', () => {
  it('sets extras, level and fingerprint, and hands out the last event id and the scopes', async () => {
    expect(Probara.lastEventId()).toBeUndefined();
    init();
    Probara.setExtras({ job: 'sync' });
    Probara.setLevel('warning');
    Probara.setFingerprint(['sync']);
    const id = Probara.captureMessage('one');
    expect(Probara.lastEventId()).toBe(id);
    await Probara.flush(2000);
    expect(ingest.events()[0]).toMatchObject({
      level: 'warning',
      fingerprint: ['sync'],
      extra: { job: 'sync' },
    });
  });

  it('gives each request handled by the middleware its own isolation scope', async () => {
    init();
    const app = new Hono();
    app.use(Probara.probaraHono());
    app.get('/:name', (c) => {
      Probara.getIsolationScope().setTag('request', c.req.param('name'));
      Probara.withScope(() => {
        expect(Probara.getCurrentScope()).not.toBe(Probara.getIsolationScope());
        Probara.captureMessage(`in ${c.req.param('name')}`);
      });
      return c.text('ok');
    });
    await app.request('http://api.test/a');
    await app.request('http://api.test/b');
    Probara.captureMessage('outside');
    await Probara.flush(2000);
    expect(ingest.events().map((event) => [event.message, event.tags])).toEqual([
      ['in a', { request: 'a' }],
      ['in b', { request: 'b' }],
      ['outside', undefined],
    ]);
  });
});

describe('the transport of @probara/node', () => {
  it('stops sending the categories X-Probara-Rate-Limits names', async () => {
    init();
    ingest.answer(() => ({ status: 200, headers: { 'x-probara-rate-limits': '60:error:key' } }));
    Probara.captureMessage('first');
    await Probara.flush(2000);
    Probara.captureMessage('limited');
    await Probara.flush(2000);
    expect(ingest.events().map((event) => event.message)).toEqual(['first']);
  });

  it('keeps an envelope the ingest answered with a 5xx in memory and retries it with backoff', async () => {
    init();
    let failures = 1;
    ingest.answer(() => {
      if (failures === 0) return { status: 200 };
      failures -= 1;
      return { status: 503 };
    });
    Probara.captureMessage('retried');
    await Probara.flush(2000);
    await vi.waitFor(
      () => {
        expect(ingest.events().map((event) => event.message)).toEqual(['retried', 'retried']);
      },
      { timeout: 3000 },
    );
  });

  it('sends a client report of what it dropped when it closes', async () => {
    init({ sampleRate: 0 });
    Probara.captureMessage('sampled out');
    await Probara.close(2000);
    expect(reports()).toEqual([
      {
        timestamp: expect.any(Number) as number,
        discarded_events: [{ reason: 'sample_rate', category: 'error', quantity: 1 }],
      },
    ]);
  });
});

describe('the modules of @probara/node', () => {
  it('lists the dependencies of the app with their installed versions on each event', async () => {
    writeFileSync(
      join(scratch, 'package.json'),
      JSON.stringify({ dependencies: { express: '^5.0.0' }, devDependencies: { left: '~1.0.0' } }),
    );
    mkdirSync(join(scratch, 'node_modules', 'express'), { recursive: true });
    writeFileSync(
      join(scratch, 'node_modules', 'express', 'package.json'),
      JSON.stringify({ name: 'express', version: '5.3.1' }),
    );
    init({ appRoot: scratch });
    Probara.captureMessage('with modules');
    await Probara.flush(2000);
    expect(ingest.events()[0]?.modules).toEqual({ express: '5.3.1', left: '~1.0.0' });
  });
});
