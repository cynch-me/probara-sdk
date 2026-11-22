import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CreateSnapBuildRequest, FinalizeSnapShardRequest } from './api.js';
import type { Logger } from './logger.js';
import { sha256Of, uploadSnapScreenshots, type UploadSnapOptions } from './snap.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const COMMIT = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const BUILD = '01J9Z3K4M5N6P7Q8R9S0T1V2B1';
const SHARD = '01J9Z3K4M5N6P7Q8R9S0T1V2S1';
const BUILDS = `${BASE_URL}/api/v1/projects/SHOP/snap/builds`;
const BUILD_URL = `${BASE_URL}/projects/SHOP/snap/builds/4`;
const ENV = {
  PROBARA_API_TOKEN: TOKEN,
  PROBARA_PROJECT: 'SHOP',
  PROBARA_BASE_URL: BASE_URL,
  PROBARA_COMMIT: COMMIT,
  PROBARA_BRANCH: 'feat/cart',
};

const scratch = mkdtempSync(join(tmpdir(), 'probara-core-snap-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Bytes with a PNG signature; `seed` makes each one a different file. */
function png(seed: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function apiError(status: number, code: string, details?: unknown): Response {
  return json(status, { error: { code, message: `${code} happened`, details } });
}

interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

/**
 * A Snap ingest in memory behind `fetch`: it holds the digests it was given (`held`) and those
 * uploaded, answers a finalize that names one it does not hold with 409 `missingFiles`, and
 * answers `scripted` responses first, by route.
 */
function setup(options: Partial<UploadSnapOptions> = {}, held: readonly string[] = []) {
  const requests: Recorded[] = [];
  const lines: string[] = [];
  const files = new Set(held);
  const scripted: Record<'create' | 'upload' | 'finalize', Response[]> = {
    create: [],
    upload: [],
    finalize: [],
  };
  let inFlight = 0;
  let mostInFlight = 0;
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  const build = (jobStatus: string, screenshotCount: number) => ({
    ulid: BUILD,
    number: 4,
    name: 'default',
    jobStatus,
    screenshotCount,
    url: BUILD_URL,
  });
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const upload = /\/files\/([0-9a-f]{64})$/.exec(url);
    const body: unknown =
      upload === null ? JSON.parse(init.body as string) : await (init.body as Blob).arrayBuffer();
    requests.push({ method, url, headers: new Headers(init.headers), body });
    if (upload !== null) {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const next = scripted.upload.shift();
      if (next !== undefined) return next;
      const digest = sha256Of(new Uint8Array(body as ArrayBuffer));
      if (digest !== upload[1]) return apiError(422, 'validation_failed');
      files.add(digest);
      return json(200, { sha256: digest, stored: true });
    }
    if (url === BUILDS) {
      const declared = (body as CreateSnapBuildRequest).files.map((file) => file.sha256);
      return (
        scripted.create.shift() ??
        json(201, {
          build: build('pending', 0),
          shardUlid: SHARD,
          missingFiles: declared.filter((digest) => !files.has(digest)),
        })
      );
    }
    const next = scripted.finalize.shift();
    if (next !== undefined) return next;
    const { screenshots } = body as FinalizeSnapShardRequest;
    const missingFiles = screenshots.map((entry) => entry.sha256).filter((sha) => !files.has(sha));
    if (missingFiles.length > 0) return apiError(409, 'conflict', { missingFiles });
    return json(200, build('progress', screenshots.length));
  };
  const upload = (screenshots: UploadSnapOptions['screenshots']) =>
    uploadSnapScreenshots({
      env: ENV,
      fetch: fetchImpl,
      sleep: () => Promise.resolve(),
      random: () => 0,
      logger,
      ...options,
      screenshots,
    });
  const to = (route: 'create' | 'upload' | 'finalize') =>
    requests.filter(({ url }) =>
      route === 'create'
        ? url === BUILDS
        : route === 'upload'
          ? url.includes('/files/')
          : url.endsWith(':finalize'),
    );
  const loud = () => lines.filter((line) => !line.startsWith('debug: '));
  return { upload, requests, to, lines, loud, files, scripted, most: () => mostInFlight };
}

const home = { name: 'home', body: png(1) };
const cart = { name: 'cart', body: png(2) };

function takenBy(
  automationKey: string,
): NonNullable<UploadSnapOptions['screenshots'][number]['test']> {
  return { automationKey, titlePath: [automationKey], retry: 0 };
}

describe('sha256Of', () => {
  it('hashes bytes to the lowercase hex digest the Snap API names files by', () => {
    expect(sha256Of(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Of(png(1))).not.toBe(sha256Of(png(2)));
  });
});

describe('uploadSnapScreenshots', () => {
  it('creates the build, uploads only the files Probara does not hold, and finalizes the shard', async () => {
    const { upload, to, requests } = setup({}, [sha256Of(png(2))]);

    const summary = await upload([
      {
        ...home,
        browser: 'chromium',
        viewport: { width: 1280, height: 720 },
        colorMode: 'dark',
        threshold: 0.2,
        test: { automationKey: 'k1', caseDisplayIds: ['SHOP-1'], titlePath: ['opens'], retry: 1 },
      },
      cart,
    ]);

    expect(to('create')[0]?.body).toEqual({
      commit: COMMIT,
      branch: 'feat/cart',
      files: [{ sha256: sha256Of(png(1)) }, { sha256: sha256Of(png(2)) }],
    });
    expect(to('upload').map(({ method, url }) => [method, url])).toEqual([
      ['PUT', `${BUILDS}/${BUILD}/files/${sha256Of(png(1))}`],
    ]);
    expect(to('upload')[0]?.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(to('upload')[0]?.body as ArrayBuffer)).toEqual(png(1));
    expect(to('finalize').map(({ url, body }) => [url, body])).toEqual([
      [
        `${BUILDS}/${BUILD}/shards/${SHARD}:finalize`,
        {
          screenshots: [
            {
              name: 'home',
              sha256: sha256Of(png(1)),
              browser: 'chromium',
              viewport: { width: 1280, height: 720 },
              colorMode: 'dark',
              threshold: 0.2,
              test: {
                automationKey: 'k1',
                caseDisplayIds: ['SHOP-1'],
                titlePath: ['opens'],
                retry: 1,
              },
            },
            { name: 'cart', sha256: sha256Of(png(2)) },
          ],
        },
      ],
    ]);
    expect(requests).toHaveLength(3);
    expect(
      requests.every(({ headers }) => headers.get('authorization') === `Bearer ${TOKEN}`),
    ).toBe(true);
    expect(summary).toEqual({
      status: 'uploaded',
      build: { ulid: BUILD, number: 4, url: BUILD_URL, jobStatus: 'progress' },
      screenshots: 2,
      files: 1,
    });
  });

  it('prints the build page to the CI output', async () => {
    const { upload, loud } = setup();

    await upload([home, cart]);

    expect(loud()).toEqual([
      `info: Sent 2 screenshots to the Snap build #4 (2 new files): ${BUILD_URL}`,
    ]);
  });

  it('sends the head commit, the base branch, the pull request and the nonce of the CI run', async () => {
    const eventPath = join(scratch, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: HEAD } } }));
    const { upload, to } = setup({
      env: {
        PROBARA_API_TOKEN: TOKEN,
        PROBARA_PROJECT: 'SHOP',
        PROBARA_BASE_URL: BASE_URL,
        GITHUB_ACTIONS: 'true',
        GITHUB_SHA: 'c'.repeat(40),
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REF: 'refs/pull/17/merge',
        GITHUB_HEAD_REF: 'feat/cart',
        GITHUB_BASE_REF: 'main',
        GITHUB_RUN_ID: '9876',
        GITHUB_RUN_ATTEMPT: '2',
      },
      buildName: 'e2e',
      shard: { index: 0, total: 2 },
      runUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2X9',
    });

    await upload([home]);

    expect(to('create')[0]?.body).toEqual({
      name: 'e2e',
      commit: HEAD,
      branch: 'feat/cart',
      baseBranch: 'main',
      pullRequestNumber: 17,
      ciProvider: 'github-actions',
      ciNonce: '9876-2',
      shard: { index: 0, total: 2 },
      runUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2X9',
      files: [{ sha256: sha256Of(png(1)) }],
    });
  });

  it('sends no nonce of the CI in a run without shards: two jobs of one CI run make a build each', async () => {
    const { upload, to } = setup({
      env: { ...ENV, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '9876', GITHUB_RUN_ATTEMPT: '2' },
    });

    await upload([home]);

    expect(to('create')[0]?.body).not.toHaveProperty('ciNonce');
    expect(to('create')[0]?.body).not.toHaveProperty('shard');
  });

  it('sends the shard of a sharded run, and refuses one without a nonce before any request', async () => {
    const shard = { index: 1, total: 3 };
    const sharded = setup({ nonce: 'nightly-7', shard });
    await sharded.upload([home]);
    expect(sharded.to('create')[0]?.body).toMatchObject({ ciNonce: 'nightly-7', shard });

    const named = setup({ buildName: 'mobile' });
    await named.upload([home]);
    expect(named.to('create')[0]?.body).toMatchObject({ name: 'mobile' });
    expect(named.to('create')[0]?.body).not.toHaveProperty('shard');

    const overridden = setup({
      env: { ...ENV, GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' },
      nonce: 'mine',
    });
    await overridden.upload([home]);
    expect(overridden.to('create')[0]?.body).toMatchObject({ ciNonce: 'mine' });

    const { upload, requests, loud } = setup({ shard });
    await expect(upload([home])).resolves.toMatchObject({ status: 'failed' });
    expect(requests).toEqual([]);
    expect(loud()).toEqual([
      'error: Could not send the Snap screenshots: a sharded run needs a nonce its shards share, and this CI gives none: set one (PROBARA_SNAP_NONCE in a reporter) to the same value in every shard',
    ]);
  });

  it('uploads the files a finalize answers 409 missingFiles for, and finalizes once more', async () => {
    const { upload, to, scripted } = setup({}, [sha256Of(png(1))]);
    scripted.finalize.push(apiError(409, 'conflict', { missingFiles: [sha256Of(png(1))] }));

    const summary = await upload([home, cart]);

    expect(to('upload').map(({ url }) => url.slice(-64))).toEqual([
      sha256Of(png(2)),
      sha256Of(png(1)),
    ]);
    expect(to('finalize')).toHaveLength(2);
    expect(to('finalize')[1]?.headers.get('idempotency-key')).not.toBe(
      to('finalize')[0]?.headers.get('idempotency-key'),
    );
    expect(summary).toMatchObject({ status: 'uploaded', screenshots: 2, files: 2 });
  });

  it('gives up when the second finalize still misses files', async () => {
    const { upload, to, scripted, loud } = setup();
    const missing = () => apiError(409, 'conflict', { missingFiles: [sha256Of(png(1))] });
    scripted.finalize.push(missing(), missing());

    const summary = await upload([home]);

    expect(to('finalize')).toHaveLength(2);
    expect(summary).toMatchObject({ status: 'failed', error: { code: 'conflict', status: 409 } });
    expect(loud()).toEqual([
      'error: Could not send the Snap screenshots: Probara answered 409 conflict: conflict happened',
    ]);
  });

  it('stops at the screenshot limit of the plan and prints what Probara says', async () => {
    const { upload, to, scripted, loud } = setup();
    scripted.finalize.push(
      json(409, {
        error: {
          code: 'snap_screenshot_limit_reached',
          message: 'The plan allows 5000 Snap screenshots per month',
        },
      }),
    );

    const summary = await upload([home]);

    expect(to('finalize')).toHaveLength(1);
    expect(summary).toEqual({
      status: 'failed',
      screenshots: 0,
      files: 1,
      error: {
        message:
          'Probara answered 409 snap_screenshot_limit_reached: The plan allows 5000 Snap screenshots per month',
        code: 'snap_screenshot_limit_reached',
        status: 409,
      },
    });
    expect(loud()).toEqual([
      'error: Could not send the Snap screenshots: Probara answered 409 snap_screenshot_limit_reached: The plan allows 5000 Snap screenshots per month',
    ]);
  });

  it('retries an upload like any request, and uploads at most `concurrency` files at a time', async () => {
    const { upload, to, scripted, most } = setup({ concurrency: 2 });
    scripted.upload.push(apiError(503, 'internal_error'));
    const many = Array.from({ length: 7 }, (_, index) => ({
      name: `page-${index}`,
      body: png(index),
    }));

    const summary = await upload(many);

    expect(summary).toMatchObject({ status: 'uploaded', screenshots: 7, files: 7 });
    expect(to('upload')).toHaveLength(8);
    expect(most()).toBe(2);
  });

  it('does not finalize when an upload fails for good', async () => {
    const { upload, to, scripted } = setup();
    scripted.upload.push(apiError(422, 'validation_failed'));

    const summary = await upload([home]);

    expect(to('finalize')).toEqual([]);
    expect(summary).toMatchObject({
      status: 'failed',
      screenshots: 0,
      files: 0,
      error: { code: 'validation_failed', status: 422 },
    });
  });

  it('sends nothing and says nothing without screenshots, or while reporting is off', async () => {
    const none = setup();
    await expect(none.upload([])).resolves.toEqual({ status: 'empty', screenshots: 0, files: 0 });
    expect(none.requests).toEqual([]);
    expect(none.lines).toEqual([]);

    const off = setup({ env: { ...ENV, PROBARA_ENABLED: 'false' } });
    await expect(off.upload([home])).resolves.toEqual({
      status: 'disabled',
      screenshots: 0,
      files: 0,
    });
    const unconfigured = setup({ env: {} });
    await expect(unconfigured.upload([home])).resolves.toMatchObject({ status: 'disabled' });
    expect([...off.requests, ...unconfigured.requests]).toEqual([]);
    expect([...off.loud(), ...unconfigured.loud()]).toEqual([]);
  });

  it('refuses a commit that is not a full SHA, a missing branch and a body that is no PNG, before any request', async () => {
    const short = setup({ env: { ...ENV, PROBARA_COMMIT: 'a1b2c3d' } });
    await short.upload([home]);
    const unbranched = setup({ env: { ...ENV, PROBARA_BRANCH: '' } });
    await unbranched.upload([home]);
    const text = setup();
    await text.upload([{ name: 'home', body: new TextEncoder().encode('<svg/>') }]);
    const unreadable = setup();
    await unreadable.upload([{ name: 'home', path: join(scratch, 'missing.png') }]);

    expect([short, unbranched, text, unreadable].flatMap(({ requests }) => requests)).toEqual([]);
    expect(short.loud()).toEqual([
      'error: Could not send the Snap screenshots: the commit must be a full 40-character SHA: set PROBARA_COMMIT',
    ]);
    expect(unbranched.loud()).toEqual([
      'error: Could not send the Snap screenshots: the branch is not known: set PROBARA_BRANCH',
    ]);
    expect(text.loud()).toEqual([
      'error: Could not send the Snap screenshots: the screenshot "home" is not a PNG',
    ]);
    expect(unreadable.loud()[0]).toMatch(
      /^error: Could not send the Snap screenshots: could not read the screenshot "home": /,
    );
  });

  it('refuses two screenshots of one test that share a name, browser, viewport and color mode', async () => {
    const { upload, requests, loud } = setup();
    const refused =
      'error: Could not send the Snap screenshots: two screenshots of one test are named "home" (same browser, viewport and color mode): a test holds one of each';

    await upload([home, { ...cart, name: 'home' }]);
    expect(requests).toEqual([]);
    expect(loud()).toEqual([refused]);

    const oneTest = setup();
    await oneTest.upload([
      { ...home, test: takenBy('a') },
      { ...cart, name: 'home', test: takenBy('a') },
    ]);
    expect(oneTest.requests).toEqual([]);
    expect(oneTest.loud()).toEqual([refused]);

    const browsers = setup();
    await browsers.upload([
      { ...home, browser: 'chromium' },
      { ...home, browser: 'firefox' },
    ]);
    expect(browsers.to('finalize')).toHaveLength(1);
  });

  it('sends the same name taken by two tests as two screenshots of the build', async () => {
    const { upload, to, loud } = setup();

    await upload([
      { ...home, test: takenBy('home.spec.ts > renders') },
      { ...cart, name: 'home', test: takenBy('cart.spec.ts > renders') },
    ]);

    expect(to('finalize').map(({ body }) => body)).toEqual([
      {
        screenshots: [
          { name: 'home', sha256: sha256Of(png(1)), test: takenBy('home.spec.ts > renders') },
          { name: 'home', sha256: sha256Of(png(2)), test: takenBy('cart.spec.ts > renders') },
        ],
      },
    ]);
    expect(loud()).toEqual([
      `info: Sent 2 screenshots to the Snap build #4 (2 new files): ${BUILD_URL}`,
    ]);
  });

  it('finalizes the shard of a sharded run that took no screenshot, quietly', async () => {
    const { upload, to, loud, lines } = setup({ shard: { index: 1, total: 2 }, nonce: 'run-42' });

    const summary = await upload([]);

    expect(to('create').map(({ body }) => body)).toEqual([
      {
        commit: COMMIT,
        branch: 'feat/cart',
        ciNonce: 'run-42',
        shard: { index: 1, total: 2 },
        files: [],
      },
    ]);
    expect(to('upload')).toEqual([]);
    expect(to('finalize').map(({ body }) => body)).toEqual([{ screenshots: [] }]);
    expect(summary).toMatchObject({ status: 'uploaded', screenshots: 0, files: 0 });
    expect(loud()).toEqual([]);
    expect(lines).toContain(
      `debug: Finalized the shard 2 of 2 of the Snap build #4 without screenshots: ${BUILD_URL}`,
    );
  });

  it('joins the build of a run split across machines by its nonce alone, without a shard total', async () => {
    const env = { ...ENV, GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' };
    const { upload, to, loud } = setup({ parallel: true, env });

    const summary = await upload([home]);

    expect(to('create')[0]?.body).toMatchObject({ ciNonce: '4521' });
    expect(to('create')[0]?.body).not.toHaveProperty('shard');
    expect(summary).toMatchObject({ status: 'uploaded', screenshots: 1 });
    expect(loud()).toEqual([
      `info: Sent 1 screenshot to the Snap build #4 (1 new file), which waits for "probara snap finalize": ${BUILD_URL}`,
    ]);

    const named = setup({ parallel: true, env, nonce: 'mine' });
    await named.upload([home]);
    expect(named.to('create')[0]?.body).toMatchObject({ ciNonce: 'mine' });
    expect(named.to('create')[0]?.body).not.toHaveProperty('shard');
  });

  it('joins the build of a split run from a machine that took no screenshot, quietly', async () => {
    const { upload, to, loud, lines } = setup({ parallel: true, nonce: 'run-42' });

    const summary = await upload([]);

    expect(to('create').map(({ body }) => body)).toEqual([
      { commit: COMMIT, branch: 'feat/cart', ciNonce: 'run-42', files: [] },
    ]);
    expect(to('finalize').map(({ body }) => body)).toEqual([{ screenshots: [] }]);
    expect(summary).toMatchObject({ status: 'uploaded', screenshots: 0, files: 0 });
    expect(loud()).toEqual([]);
    expect(lines).toContain(`debug: Joined the Snap build #4 without screenshots: ${BUILD_URL}`);
  });

  it('refuses a machine of a split run without a nonce before any request, and sends the shard of one that has both', async () => {
    const { upload, requests, loud } = setup({ parallel: true });

    await expect(upload([home])).resolves.toMatchObject({ status: 'failed' });

    expect(requests).toEqual([]);
    expect(loud()).toEqual([
      'error: Could not send the Snap screenshots: a run split across machines needs a nonce its machines share, and this CI gives none: set one (PROBARA_SNAP_NONCE in a reporter) to the same value on every machine',
    ]);

    const shard = { index: 0, total: 2 };
    const sharded = setup({ parallel: true, shard, nonce: 'run-42' });
    await sharded.upload([home]);
    expect(sharded.to('create')[0]?.body).toMatchObject({ ciNonce: 'run-42', shard });
  });

  it('reads a screenshot from its file, and lowercases the commit', async () => {
    const path = join(scratch, 'home.png');
    writeFileSync(path, png(9));
    const { upload, to } = setup({ env: { ...ENV, PROBARA_COMMIT: 'A'.repeat(40) } });

    await upload([{ name: 'home', path }]);

    expect(to('create')[0]?.body).toMatchObject({ commit: COMMIT });
    expect(new Uint8Array(to('upload')[0]?.body as ArrayBuffer)).toEqual(png(9));
  });

  it('never rejects and never logs the token', async () => {
    const { upload, lines } = setup({
      fetch: () => Promise.reject(new Error(`socket hang up ${TOKEN}`)),
      maxRetries: 0,
    });

    await expect(upload([home])).resolves.toMatchObject({ status: 'failed' });
    await expect(
      uploadSnapScreenshots(null as unknown as UploadSnapOptions),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).toContain('[redacted]');
  });
});
