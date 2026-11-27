import type { AddressInfo } from 'node:net';
import express from 'express';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startIngest, type FakeIngest } from '../test/ingest.js';
import * as Probara from './index.js';

let ingest: FakeIngest;

beforeEach(async () => {
  ingest = await startIngest();
  Probara.init({ dsn: ingest.dsn, onUncaughtException: 'keep-alive' });
});

afterEach(async () => {
  await Probara.close(1000);
  await ingest.close();
});

const SECRET_HEADERS = {
  authorization: 'Bearer abc',
  cookie: 'sid=1',
  'x-api-key': 'k-1',
  'x-forwarded-for': '203.0.113.9',
  'x-request-id': 'req-7',
};

async function withServer(app: express.Express, run: (origin: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${String(port)}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('the Express middleware', () => {
  function app() {
    const out = express();
    out.use(Probara.probaraRequestHandler());
    out.get('/orders/:id', async (request, response) => {
      Probara.setTag('order', request.params.id);
      await new Promise((resolve) => setTimeout(resolve, request.params.id === 'slow' ? 30 : 1));
      throw new Error(`order ${request.params.id} broke`);
      response.end();
    });
    out.get('/missing', () => {
      throw Object.assign(new Error('not here'), { status: 404 });
    });
    out.use(Probara.probaraErrorHandler());
    return out;
  }

  it('captures errors of each request with its own scope and a scrubbed request, and passes them on', async () => {
    await withServer(app(), async (origin) => {
      const responses = await Promise.all(
        ['slow', 'fast'].map((id) =>
          fetch(`${origin}/orders/${id}?page=2&access_token=t0k`, { headers: SECRET_HEADERS }),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual([500, 500]);
    });
    await Probara.flush(2000);
    const events = ingest.events();
    expect(
      events.map((event) => [event.exception?.values.at(-1)?.value, event.tags?.['order']]).sort(),
    ).toEqual([
      ['order fast broke', 'fast'],
      ['order slow broke', 'slow'],
    ]);
    const event = events[0];
    expect(event?.exception?.values.at(-1)?.mechanism).toEqual({ type: 'express', handled: false });
    expect(event?.request?.method).toBe('GET');
    expect(event?.request?.url).toMatch(
      /\/orders\/(slow|fast)\?page=2&access_token=%5BFiltered%5D$/,
    );
    expect(event?.request?.headers?.['x-request-id']).toBe('req-7');
    for (const name of ['authorization', 'cookie', 'x-api-key', 'x-forwarded-for']) {
      expect(event?.request?.headers?.[name]).toBeUndefined();
    }
  });

  it('passes errors below 500 on without capturing them', async () => {
    await withServer(app(), async (origin) => {
      expect((await fetch(`${origin}/missing`)).status).toBe(404);
    });
    await Probara.flush(2000);
    expect(ingest.events()).toEqual([]);
  });
});

describe('the Hono middleware', () => {
  function app() {
    const out = new Hono();
    out.use(Probara.probaraHono());
    out.get('/boom', (c) => {
      Probara.setTag('route', c.req.path);
      throw new Error('hono broke');
    });
    out.get('/denied', () => {
      throw new HTTPException(401, { message: 'no' });
    });
    out.onError((error, c) =>
      c.text('handled', error instanceof HTTPException ? error.status : 500),
    );
    return out;
  }

  it('captures thrown errors with the request, and leaves the response to onError', async () => {
    const response = await app().request('http://api.test/boom?password=p4ss', {
      headers: SECRET_HEADERS,
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('handled');
    await Probara.flush(2000);
    const [event] = ingest.events();
    expect(event?.exception?.values.at(-1)).toMatchObject({
      value: 'hono broke',
      mechanism: { type: 'hono', handled: false },
    });
    expect(event?.tags).toEqual({ route: '/boom' });
    expect(event?.request).toEqual({
      method: 'GET',
      url: 'http://api.test/boom?password=%5BFiltered%5D',
      headers: { 'x-request-id': 'req-7' },
    });
  });

  it('never captures HTTP exceptions below 500', async () => {
    expect((await app().request('http://api.test/denied')).status).toBe(401);
    await Probara.flush(2000);
    expect(ingest.events()).toEqual([]);
  });
});
