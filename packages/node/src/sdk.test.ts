import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startIngest, startUpstream, type FakeIngest } from '../test/ingest.js';
import * as Probara from './index.js';

let ingest: FakeIngest;
let scratch: string;

beforeEach(async () => {
  ingest = await startIngest();
  scratch = mkdtempSync(join(tmpdir(), 'probara-node-'));
});

afterEach(async () => {
  await Probara.close(1000);
  await ingest.close();
  rmSync(scratch, { recursive: true, force: true });
  delete process.env['PROBARA_RELEASE'];
  delete process.env['PROBARA_ENVIRONMENT'];
});

const init = (options: Partial<Probara.NodeOptions> = {}) => {
  Probara.init({ dsn: ingest.dsn, onUncaughtException: 'keep-alive', ...options });
};

/** Imports a module written to the scratch directory, so its errors have frames in a real file. */
async function moduleAt<T>(path: string, source: string): Promise<T> {
  const file = join(scratch, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, source);
  return (await import(pathToFileURL(file).href)) as T;
}

describe('@probara/node', () => {
  it('posts a node event with the key header and a text/plain body, release and environment from the environment', async () => {
    process.env['PROBARA_RELEASE'] = 'api@1.4.0';
    process.env['PROBARA_ENVIRONMENT'] = 'staging';
    init();
    const id = Probara.captureException(new Error('payment failed'));
    expect(await Probara.flush(2000)).toBe(true);
    const [received] = ingest.received;
    expect(received?.headers['probara-error-key']).toBe('pek_test');
    expect(received?.headers['content-type']).toBe('text/plain;charset=UTF-8');
    expect(received?.url.startsWith('/api/v1/public/errors/envelope')).toBe(true);
    const [event] = ingest.events();
    expect(event).toMatchObject({
      event_id: id,
      platform: 'node',
      release: 'api@1.4.0',
      environment: 'staging',
      server_name: hostname(),
      sdk: { name: Probara.SDK_NAME, version: Probara.VERSION },
    });
    expect(event?.contexts?.['runtime']).toEqual({ name: 'node', version: process.version });
    expect(event?.contexts?.['os']?.['name']).toEqual(expect.any(String));
    expect(event?.contexts?.['app']?.['app_start_time']).toEqual(expect.any(String));
    expect(event?.exception?.values.at(-1)).toMatchObject({
      type: 'Error',
      value: 'payment failed',
      mechanism: { type: 'generic', handled: true },
    });
  });

  it('takes the environment from NODE_ENV when PROBARA_ENVIRONMENT is not set, and the options over both', async () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'qa';
    try {
      init();
      Probara.captureMessage('one');
      await Probara.flush(2000);
      init({ release: 'given', environment: 'given-env', serverName: 'box-1' });
      Probara.captureMessage('two');
      await Probara.flush(2000);
    } finally {
      process.env['NODE_ENV'] = previous;
    }
    const [first, second] = ingest.events();
    expect(first?.environment).toBe('qa');
    expect(second).toMatchObject({
      release: 'given',
      environment: 'given-env',
      server_name: 'box-1',
    });
  });

  it('adds five lines of source around in-app frames, none to dependencies or files over 1 MB', async () => {
    init();
    const lines = Array.from({ length: 20 }, (_, index) => `// line ${String(index + 1)}`);
    lines[9] = 'export function boom() { throw new Error("in app"); }';
    const app = await moduleAt<{ boom(): void }>('app.mjs', lines.join('\n'));
    const dependency = await moduleAt<{ boom(): void }>(
      'node_modules/lib/index.mjs',
      'export function boom() { throw new Error("in lib"); }\n',
    );
    const big = await moduleAt<{ boom(): void }>(
      'big.mjs',
      `${'// padding\n'.repeat(100_000)}export function boom() { throw new Error("in big"); }\n`,
    );
    for (const module of [app, dependency, big]) {
      try {
        module.boom();
      } catch (error) {
        Probara.captureException(error);
      }
    }
    await Probara.flush(2000);
    const crashing = ingest
      .events()
      .map((event) => event.exception?.values.at(-1)?.stacktrace?.frames.at(-1));
    expect(crashing[0]).toMatchObject({
      in_app: true,
      lineno: 10,
      pre_context: lines.slice(4, 9),
      context_line: lines[9],
      post_context: lines.slice(10, 15),
    });
    expect(crashing[1]?.in_app).toBe(false);
    expect(crashing[1]?.context_line).toBeUndefined();
    expect(crashing[2]?.in_app).toBe(true);
    expect(crashing[2]?.context_line).toBeUndefined();
  });

  it('keeps tags, user and breadcrumbs of concurrent work apart with withScope', async () => {
    init();
    Probara.setTag('service', 'api');
    const work = async (name: string, wait: number) =>
      Probara.withScope(async (scope) => {
        scope.setTag('job', name);
        Probara.setUser({ id: `user-${name}`, email: 'not@sent.test' } as Probara.User);
        Probara.addBreadcrumb({ message: `start ${name}` });
        await new Promise((resolve) => setTimeout(resolve, wait));
        Probara.captureMessage(`done ${name}`);
      });
    await Promise.all([work('a', 30), work('b', 5)]);
    Probara.captureMessage('outside');
    await Probara.flush(2000);
    const byMessage: Record<string, Probara.ProbaraEvent> = Object.fromEntries(
      ingest.events().map((event) => [event.message ?? '', event]),
    );
    expect(byMessage['done a']).toMatchObject({
      tags: { service: 'api', job: 'a' },
      user: { id: 'user-a' },
    });
    expect(byMessage['done a']?.breadcrumbs?.values.map((crumb) => crumb.message)).toEqual([
      'start a',
    ]);
    expect(byMessage['done b']).toMatchObject({
      tags: { service: 'api', job: 'b' },
      user: { id: 'user-b' },
    });
    expect(byMessage['outside']?.tags).toEqual({ service: 'api' });
    expect(byMessage['outside']?.user).toBeUndefined();
  });

  it('records outgoing fetch requests as breadcrumbs and sends 5xx of the targets as events, never 400, 401 or 404', async () => {
    const upstream = await startUpstream();
    try {
      init({ httpErrors: { targets: [upstream.origin], statuses: [[400, 599]] } });
      for (const status of [200, 404, 401, 400, 503]) {
        await fetch(`${upstream.origin}/orders?status=${String(status)}&token=s3cret`);
      }
      Probara.captureMessage('after');
      await Probara.flush(2000);
    } finally {
      await upstream.close();
    }
    const events = ingest.events();
    const httpEvents = events.filter((event) => event.exception !== undefined);
    expect(httpEvents.map((event) => event.contexts?.['response'])).toEqual([{ status_code: 503 }]);
    expect(httpEvents[0]?.exception?.values[0]?.mechanism).toMatchObject({
      type: 'http.client',
      handled: false,
    });
    const crumbs = events.find((event) => event.message === 'after')?.breadcrumbs?.values ?? [];
    expect(crumbs.map((crumb) => [crumb.data?.['status_code'], crumb.level])).toEqual([
      [200, 'info'],
      [404, 'warning'],
      [401, 'warning'],
      [400, 'warning'],
      [503, 'error'],
    ]);
    expect(JSON.stringify(crumbs)).not.toContain('s3cret');
    expect(crumbs.every((crumb) => crumb.category === 'fetch')).toBe(true);
  });

  it('pauses after a 429 for as long as Retry-After says', async () => {
    init();
    ingest.answer(() => ({ status: 429, headers: { 'retry-after': '60' } }));
    Probara.captureMessage('first');
    await Probara.flush(2000);
    Probara.captureMessage('second');
    await Probara.flush(2000);
    expect(ingest.events().map((event) => event.message)).toEqual(['first']);
  });

  it('gives up flushing after the timeout, and sends nothing once closed', async () => {
    init();
    ingest.answer(() => ({ status: 200, hang: true }));
    Probara.captureMessage('stuck');
    expect(await Probara.flush(50)).toBe(false);
    await Probara.close(50);
    ingest.answer(() => ({ status: 200 }));
    Probara.captureMessage('after close');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ingest.events().map((event) => event.message)).toEqual(['stuck']);
  });

  it('stays off with a DSN it cannot read', async () => {
    Probara.init({ dsn: 'not a dsn' });
    expect(Probara.captureMessage('nothing')).toBe('');
    expect(await Probara.flush(100)).toBe(true);
    expect(ingest.received).toEqual([]);
  });
});
