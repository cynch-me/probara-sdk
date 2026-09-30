/**
 * `redirect-fetch.mjs`, loaded by every command the docs tests run: each request goes to the fake
 * Probara, whatever base URL it names, and stays the same request.
 */
import { afterEach, describe, expect, it } from 'vitest';

const REDIRECT = new URL('../fixtures/docs/redirect-fetch.mjs', import.meta.url).href;
const TARGET = 'http://127.0.0.1:4321';
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PROBARA_DOCS_FAKE_URL;
});

/** Loads the redirect over a fetch that records what reaches it; returns the redirected fetch. */
async function redirected(): Promise<{ fetch: typeof fetch; seen: Request[] }> {
  const seen: Request[] = [];
  globalThis.fetch = (input, init) => {
    seen.push(new Request(input, init));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  process.env.PROBARA_DOCS_FAKE_URL = TARGET;
  // A fresh copy each time: the module wraps the fetch it finds when it loads.
  await import(`${REDIRECT}?load=${String(Math.random())}`);
  return { fetch: globalThis.fetch, seen };
}

describe('the fetch redirect of the docs tests', () => {
  it('sends a URL and its init to the fake, keeping the path and the query', async () => {
    const { fetch, seen } = await redirected();
    await fetch('https://app.probara.net/api/v1/projects/SHOP/reports?x=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });

    const [request] = seen;
    expect(request?.url).toBe(`${TARGET}/api/v1/projects/SHOP/reports?x=1`);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(await request?.text()).toBe('{"a":1}');
  });

  it("keeps a Request's method, headers and body", async () => {
    const { fetch, seen } = await redirected();
    await fetch(
      new Request('https://probara.example.com/api/v1/runs/R/close', {
        method: 'POST',
        headers: { authorization: 'Bearer x', 'idempotency-key': 'k-1' },
        body: 'closing',
      }),
    );

    const [request] = seen;
    expect(request?.url).toBe(`${TARGET}/api/v1/runs/R/close`);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('authorization')).toBe('Bearer x');
    expect(request?.headers.get('idempotency-key')).toBe('k-1');
    expect(await request?.text()).toBe('closing');
  });

  it('lets the init of a call win over its Request, like fetch does', async () => {
    const { fetch, seen } = await redirected();
    await fetch(new Request('https://app.probara.net/api/v1/x', { method: 'POST', body: 'a' }), {
      method: 'PUT',
      body: 'b',
    });

    expect(seen[0]?.method).toBe('PUT');
    expect(await seen[0]?.text()).toBe('b');
  });
});
