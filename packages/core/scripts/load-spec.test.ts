import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSpec } from './load-spec.ts';

const URL_SOURCE = 'https://docs.probara.test/openapi/v1.json';
const spec = { openapi: '3.1.0', info: { title: 'Probara', version: '1' }, paths: {} };

/** A fetch that never answers and rejects with the signal's reason once it aborts. */
const hanging: typeof fetch = (_input, init) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(init.signal?.reason as Error);
    });
  });

describe('loadSpec', () => {
  it('fetches a URL source', async () => {
    const fetchSpec: typeof fetch = () => Promise.resolve(Response.json(spec));
    await expect(loadSpec(URL_SOURCE, { fetch: fetchSpec })).resolves.toEqual(spec);
  });

  it('fails with a clear error when the fetch outlives its timeout', async () => {
    await expect(loadSpec(URL_SOURCE, { fetch: hanging, timeoutMs: 5 })).rejects.toThrow(
      `Fetching ${URL_SOURCE} timed out after 5 ms`,
    );
  });

  it('fails on an error status', async () => {
    const failing: typeof fetch = () => Promise.resolve(new Response('down', { status: 503 }));
    await expect(loadSpec(URL_SOURCE, { fetch: failing })).rejects.toThrow(
      `Fetching ${URL_SOURCE} failed with HTTP 503`,
    );
  });

  it('reads a file source', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'probara-spec-')), 'spec.json');
    await writeFile(path, JSON.stringify(spec));
    await expect(loadSpec(path)).resolves.toEqual(spec);
  });
});
