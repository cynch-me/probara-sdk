import { describe, expect, it } from 'vitest';
import type { Logger } from './logger.js';
import { finalizeSnapBuildByNonce, type FinalizeSnapOptions } from './snap-finalize.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const FINALIZE = `${BASE_URL}/api/v1/projects/SHOP/snap/builds:finalize`;
const BUILD_URL = `${BASE_URL}/projects/SHOP/snap/01J9Z3K4M5N6P7Q8R9S0T1V2B4`;
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: BASE_URL };
const BUILD = {
  ulid: '01J9Z3K4M5N6P7Q8R9S0T1V2B1',
  number: 4,
  name: 'default',
  jobStatus: 'progress',
  screenshotCount: 3,
  url: BUILD_URL,
};

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(answer: () => Response, options: Partial<FinalizeSnapOptions> = {}) {
  const requests: { method: string; url: string; body: unknown; key: string | null }[] = [];
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  const fetchImpl: typeof fetch = (input, init = {}) => {
    requests.push({
      method: init.method ?? 'GET',
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      body: JSON.parse(init.body as string) as unknown,
      key: new Headers(init.headers).get('idempotency-key'),
    });
    return Promise.resolve(answer());
  };
  const finalize = () =>
    finalizeSnapBuildByNonce({
      env: ENV,
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
      random: () => 0,
      logger,
      ...options,
    });
  return {
    finalize,
    requests,
    lines: { all: lines, loud: () => lines.filter((line) => !line.startsWith('debug: ')) },
  };
}

describe('finalizeSnapBuildByNonce', () => {
  it('finalizes the build of the nonce and logs its page', async () => {
    const { finalize, requests, lines } = setup(() => json(200, BUILD), { nonce: 'run-42' });

    const summary = await finalize();

    expect(summary).toEqual({
      status: 'finalized',
      build: { ulid: BUILD.ulid, number: 4, url: BUILD_URL, jobStatus: 'progress' },
    });
    expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: 'POST', url: FINALIZE, body: { ciNonce: 'run-42' } },
    ]);
    expect(requests[0]?.key).toMatch(/\S/);
    expect(lines.loud()).toEqual([
      `info: Finalized the Snap build #4 (3 screenshots): ${BUILD_URL}`,
    ]);
  });

  it('names the build, and takes the nonce the CI gives when none is set', async () => {
    const env = { ...ENV, GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' };
    const { finalize, requests } = setup(() => json(200, BUILD), { env, buildName: 'mobile' });

    await finalize();

    expect(requests.map(({ body }) => body)).toEqual([{ name: 'mobile', ciNonce: '4521' }]);
  });

  it('sends nothing without a nonce, saying how to set one', async () => {
    const { finalize, requests, lines } = setup(() => json(200, BUILD));

    const summary = await finalize();

    expect(summary).toMatchObject({ status: 'failed' });
    expect(requests).toEqual([]);
    expect(lines.loud()).toEqual([
      'error: Could not finalize the Snap build: no nonce names the build, and this CI gives none: set PROBARA_SNAP_NONCE to the value its machines sent',
    ]);
  });

  it.each([
    [404, 'not_found', 'no snap build has this name and CI nonce'],
    [409, 'conflict', 'finalize at least one shard before finalizing the build'],
    [422, 'validation_failed', 'this build is finalized when its shards are finalized'],
  ])('reports a %i refusal with what Probara says', async (status, code, message) => {
    const { finalize, lines } = setup(() => json(status, { error: { code, message } }), {
      nonce: 'run-42',
    });

    const summary = await finalize();

    expect(summary).toMatchObject({ status: 'failed', error: { code, status } });
    expect(summary.error?.message).toContain(message);
    expect(lines.loud()).toHaveLength(1);
    expect(lines.loud()[0]).toMatch(/^error: Could not finalize the Snap build: /);
    expect(lines.loud()[0]).toContain(message);
  });

  it('sends nothing while reporting is off, and never logs the token', async () => {
    const off = setup(() => json(200, BUILD), {
      nonce: 'run-42',
      env: { ...ENV, PROBARA_ENABLED: 'false' },
    });
    await expect(off.finalize()).resolves.toEqual({ status: 'disabled' });
    expect(off.requests).toEqual([]);

    const leaking = setup(
      () => json(500, { error: { code: 'internal_error', message: `bad ${TOKEN}` } }),
      { nonce: 'run-42', maxRetries: 0 },
    );
    await expect(leaking.finalize()).resolves.toMatchObject({ status: 'failed' });
    expect(leaking.lines.all.join('\n')).not.toContain(TOKEN);
  });
});
