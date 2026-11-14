import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixturePath } from './fixtures.js';
import { createFakeVisApi, PART_SIZE, type FakeVisApi } from './support/fake-vis.js';
import { runCli, TOKEN, type CliRun } from './support/run-cli.js';

const BASE_URL = 'https://probara.test';
const MIB = 1024 * 1024;
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_BASE_URL: BASE_URL };

let api: FakeVisApi;
let dir: string;

/** The start of a WebM file whose Segment records no length (as a browser's MediaRecorder writes). */
function webmBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([
    0x1a, 0x45, 0xdf, 0xa3, 0x8f, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04,
    0x42, 0x85, 0x81, 0x02, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ]);
  return bytes;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49]);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'probara-vis-'));
  await writeFile(join(dir, 'big.webm'), webmBytes(20 * MIB));
  await writeFile(join(dir, 'short.webm'), webmBytes(1024));
  await writeFile(join(dir, 'screen.png'), PNG);
  await writeFile(join(dir, 'notes.txt'), 'just text');
  await writeFile(join(dir, 'broken.zip'), 'not a zip archive');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  api = createFakeVisApi({ token: TOKEN });
});

async function probara(
  args: readonly string[],
  options: {
    env?: Record<string, string | undefined>;
    prompt?: (q: string) => Promise<string>;
  } = {},
): Promise<CliRun> {
  const run = await runCli(args, {
    env: options.env ?? ENV,
    cwd: dir,
    fetch: api.fetch,
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
  });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

describe('probara vis list', () => {
  it('prints one line per Vis, newest first, and the page on stderr', async () => {
    api.seed({ title: 'Older' });
    api.seed({ title: 'Newer', kind: 'screenshot' });

    const result = await probara(['vis', 'list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        'VIS-2  screenshot  ready  2026-01-01  Newer',
        'VIS-1  video       ready  2026-01-01  Older',
        '',
      ].join('\n'),
    );
    expect(result.stderr).toContain('[probara] Page 1 of 1: 2 Vises');
  });

  it('sends every filter and the page to Probara, and prints the page as JSON', async () => {
    const result = await probara([
      'vis',
      'list',
      '--kind',
      'video',
      '--from',
      'cli',
      '--creator',
      '01KC0000000000000000000001',
      '--folder',
      'none',
      '--search',
      'checkout',
      '--status',
      'pending',
      '--page',
      '2',
      '--page-size',
      '10',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    const [request] = api.requestsTo('GET', /^\/api\/v1\/vises$/);
    expect(Object.fromEntries(request?.query ?? [])).toEqual({
      kind: 'video',
      source: 'cli',
      creator: '01KC0000000000000000000001',
      folder: 'none',
      q: 'checkout',
      status: 'pending',
      page: '2',
      pageSize: '10',
    });
    expect(JSON.parse(result.stdout)).toEqual({ items: [], page: 2, pageSize: 10, total: 0 });
  });

  it('needs only the token: a Vis belongs to the organization, not to a project', async () => {
    const noToken = await probara(['vis', 'list'], { env: { PROBARA_BASE_URL: BASE_URL } });

    expect(noToken.exitCode).toBe(2);
    expect(noToken.stderr).toContain('PROBARA_API_TOKEN is not set');
    expect(noToken.stderr).not.toContain('PROBARA_PROJECT');
    expect(api.requests()).toHaveLength(0);
  });

  it('shows a refusal from Probara with its message, and exits 1', async () => {
    api.fail('GET', /^\/api\/v1\/vises$/, 403, {
      error: { code: 'forbidden', message: 'Probara Vis is not on your plan' },
    });

    const result = await probara(['vis', 'list']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      '[probara] Probara answered 403 forbidden: Probara Vis is not on your plan',
    );
  });
});

describe('an app token', () => {
  it('is refused by the Vis endpoints, and the log says a personal API token is needed', async () => {
    api = createFakeVisApi({ token: 'probara_app_0123456789abcdef' });
    api.fail('GET', /^\/api\/v1\/vises$/, 403, {
      error: { code: 'forbidden', message: 'Forbidden' },
    });

    const result = await probara(['vis', 'list'], {
      env: { PROBARA_API_TOKEN: 'probara_app_0123456789abcdef', PROBARA_BASE_URL: BASE_URL },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'PROBARA_API_TOKEN is an app token, which can only report results: the Vis commands need a personal API token',
    );
  });
});

describe('probara vis get', () => {
  it('shows a Vis by its display ID or its ULID, with its URL', async () => {
    const vis = api.seed({ visNumber: 12, title: 'Checkout fails', pageUrl: 'https://shop.test/' });

    const byDisplayId = await probara(['vis', 'get', 'vis-12']);
    const byUlid = await probara(['vis', 'get', vis.ulid, '--json']);

    expect(byDisplayId.exitCode).toBe(0);
    expect(byDisplayId.stdout).toContain('VIS-12  Checkout fails');
    expect(byDisplayId.stdout).toContain(`ULID      ${vis.ulid}`);
    expect(byDisplayId.stdout).toContain('Page      https://shop.test/');
    expect(byDisplayId.stdout).toContain(`URL       ${BASE_URL}/vis/VIS-12`);
    expect(byUlid.exitCode).toBe(0);
    expect(JSON.parse(byUlid.stdout)).toEqual(vis);
  });

  it('exits 1 for a Vis Probara does not know, and 2 for an id that is no Vis id', async () => {
    const missing = await probara(['vis', 'get', 'VIS-99']);
    const wrong = await probara(['vis', 'get', 'SHOP-12']);

    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('Probara answered 404 not_found: Vis not found');
    expect(wrong.exitCode).toBe(2);
    expect(wrong.stderr).toContain(
      '"SHOP-12" is not a Vis: pass its ULID or its display ID, such as VIS-12',
    );
  });
});

describe('probara vis update', () => {
  it('changes the title, the description and the folder, and the visibility', async () => {
    const vis = api.seed({ visNumber: 3, folderUlid: '01KF0000000000000000000001' });

    const result = await probara([
      'vis',
      'update',
      'VIS-3',
      '--title',
      'Renamed',
      '--description',
      '',
      '--folder',
      'none',
      '--visibility',
      'private',
    ]);

    expect(result.exitCode).toBe(0);
    expect(api.requestsTo('PATCH', new RegExp(`/vises/${vis.ulid}$`))[0]?.json).toEqual({
      title: 'Renamed',
      description: null,
      folderUlid: null,
    });
    expect(api.requestsTo('PATCH', /\/access$/)[0]?.json).toEqual({ mode: 'private' });
    expect(api.vis(vis.ulid)).toMatchObject({ title: 'Renamed', accessMode: 'private' });
    expect(result.stderr).toContain(`[probara] Updated VIS-3: ${BASE_URL}/vis/VIS-3`);
  });

  it('is a usage error (2) with nothing to change', async () => {
    api.seed({ visNumber: 3 });

    const result = await probara(['vis', 'update', 'VIS-3']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'Nothing to change: pass --title, --description, --folder or --visibility',
    );
    expect(api.requests()).toHaveLength(0);
  });
});

describe('probara vis delete', () => {
  it('deletes once the terminal confirms, and keeps the Vis when it does not', async () => {
    const kept = api.seed({ visNumber: 4, title: 'Keep me' });
    const gone = api.seed({ visNumber: 5, title: 'Drop me' });
    const questions: string[] = [];

    const declined = await probara(['vis', 'delete', 'VIS-4'], {
      prompt: (question) => {
        questions.push(question);
        return Promise.resolve('n');
      },
    });
    const confirmed = await probara(['vis', 'delete', 'VIS-5'], {
      prompt: () => Promise.resolve('y'),
    });

    expect(questions).toEqual([
      'Delete VIS-4 "Keep me" and all its media? It cannot be restored. [y/N] ',
    ]);
    expect(declined.exitCode).toBe(1);
    expect(declined.stderr).toContain('[probara] Not deleted: VIS-4 is kept');
    expect(api.vis(kept.ulid)).toBeDefined();
    expect(confirmed.exitCode).toBe(0);
    expect(confirmed.stderr).toContain('[probara] Deleted VIS-5 "Drop me"');
    expect(api.vis(gone.ulid)).toBeUndefined();
  });

  it('deletes without asking with --yes, and refuses without it when there is no terminal', async () => {
    const vis = api.seed({ visNumber: 6 });

    const refused = await probara(['vis', 'delete', 'VIS-6']);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain(
      'Not deleted: stdin is not a terminal, so there is no one to confirm. Pass --yes to delete VIS-6',
    );
    expect(api.vis(vis.ulid)).toBeDefined();

    const deleted = await probara(['vis', 'delete', vis.ulid, '--yes', '--json']);
    expect(deleted.exitCode).toBe(0);
    expect(JSON.parse(deleted.stdout)).toEqual({
      status: 'deleted',
      ulid: vis.ulid,
      displayId: 'VIS-6',
    });
    expect(api.vis(vis.ulid)).toBeUndefined();
  });
});

describe('probara vis create', () => {
  it('uploads a screenshot in one request and prints the ULID, the display ID and the URL', async () => {
    const result = await probara([
      'vis',
      'create',
      'screen.png',
      '--title',
      'Broken layout',
      '--description',
      'The **footer** overlaps',
      '--folder',
      '01KF0000000000000000000001',
      '--private',
      '--page-url',
      'https://shop.test/cart',
      '--metadata',
      'build=1.42.0',
      '--metadata',
      'flags=a,b',
    ]);

    expect(result.exitCode).toBe(0);
    const [vis] = api.vises();
    expect(result.stdout).toBe(`${vis?.ulid ?? ''} VIS-1 ${BASE_URL}/vis/VIS-1\n`);
    expect(api.requestsTo('POST', /^\/api\/v1\/vises$/)[0]?.json).toEqual({
      title: 'Broken layout',
      kind: 'screenshot',
      source: 'cli',
      description: 'The **footer** overlaps',
      folderUlid: '01KF0000000000000000000001',
      accessMode: 'private',
      pageUrl: 'https://shop.test/cart',
      metadata: { build: '1.42.0', flags: 'a,b' },
    });
    const asset = api.asset(vis?.ulid ?? '', 'screenshot');
    expect(asset?.contentType).toBe('image/png');
    expect(asset?.bytes).toEqual(PNG);
    expect(api.requestsTo('POST', /\/finalize$/)[0]?.json).toEqual({});
    expect(vis?.status).toBe('ready');
  });

  it('splits a 20 MiB video into parts of exactly 8 MiB, and finalizes it with its length', async () => {
    const result = await probara(['vis', 'create', 'big.webm', '--duration-ms', '61000']);

    expect(result.exitCode).toBe(0);
    const [vis] = api.vises();
    const parts = api.requestsTo('PUT', /\/parts\/\d+$/);
    expect(parts.map((part) => [part.path.split('/').pop(), part.bytes.byteLength])).toEqual([
      ['1', PART_SIZE],
      ['2', PART_SIZE],
      ['3', 20 * MIB - 2 * PART_SIZE],
    ]);
    expect(api.requestsTo('POST', /\/uploads$/)[0]?.json).toEqual({
      kind: 'video',
      contentType: 'video/webm',
      byteSize: 20 * MIB,
    });
    const stored = api.asset(vis?.ulid ?? '', 'video')?.bytes ?? new Uint8Array();
    expect(Buffer.from(stored).equals(webmBytes(20 * MIB))).toBe(true);
    expect(api.requestsTo('POST', /\/finalize$/)[0]?.json).toEqual({ durationMs: 61000 });
    expect(vis).toMatchObject({ title: 'big.webm', source: 'cli', status: 'ready' });
  });

  it('sends a part again after a transient failure, and only that part', async () => {
    api.fail('PUT', /\/parts\/2$/, 503, { error: { code: 'internal_error', message: 'busy' } });

    const result = await probara(['vis', 'create', 'big.webm', '--duration-ms', '61000']);

    expect(result.exitCode).toBe(0);
    const numbers = api
      .requestsTo('PUT', /\/parts\/\d+$/)
      .map((part) => part.path.split('/').pop());
    expect(numbers).toEqual(['1', '2', '2', '3']);
    expect(result.stderr).toContain('Vis part upload attempt 1 of 5 got 503');
    expect(api.vises()[0]?.status).toBe('ready');
  });

  it('shows a refusal with its message and deletes the pending Vis it created', async () => {
    api.fail('POST', /\/finalize$/, 422, {
      error: {
        code: 'validation_failed',
        message: 'The recording is longer than your plan allows',
        details: { reason: 'recording_too_long' },
      },
    });

    const result = await probara(['vis', 'create', 'short.webm', '--duration-ms', '7200000']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      '[probara] Probara answered 422 validation_failed: The recording is longer than your plan allows',
    );
    expect(result.stderr).toContain('[probara] Deleted the pending VIS-1: nothing was left behind');
    expect(api.vises()).toEqual([]);
    expect(result.stdout).toBe('');
  });

  it('needs --duration-ms for a video that does not record its length, and sends nothing', async () => {
    const result = await probara(['vis', 'create', 'short.webm']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'short.webm: the file does not record the length of the video: pass --duration-ms',
    );
    expect(api.requests()).toHaveLength(0);
  });

  it('reads the length of a Playwright video from the file', async () => {
    const result = await probara(['vis', 'create', fixturePath('vis', 'recording.webm')]);

    expect(result.exitCode).toBe(0);
    const finalized = api.requestsTo('POST', /\/finalize$/)[0]?.json as { durationMs: number };
    expect(finalized.durationMs).toBeGreaterThan(300);
    expect(finalized.durationMs).toBeLessThan(10_000);
  });

  it('refuses a file that is neither a video nor a screenshot, and sends nothing', async () => {
    const result = await probara(['vis', 'create', 'notes.txt']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'notes.txt: is not an MP4 or WebM video, nor a PNG, JPEG or WebP image',
    );
    expect(api.requests()).toHaveLength(0);
  });

  it('uploads the console, the network and the actions of a Playwright trace, redacted, timed from the video', async () => {
    const result = await probara([
      'vis',
      'create',
      fixturePath('vis', 'recording.webm'),
      '--playwright-trace',
      fixturePath('vis', 'trace.zip'),
    ]);

    expect(result.exitCode).toBe(0);
    const [vis] = api.vises();
    const ulid = vis?.ulid ?? '';
    for (const kind of ['console', 'network', 'events']) {
      expect(api.asset(ulid, kind)).toMatchObject({
        contentType: 'application/x-ndjson',
        contentEncoding: 'gzip',
      });
    }

    const consoleLines = api.stream(ulid, 'console');
    expect(consoleLines.map((line) => [line.level, line.args])).toEqual([
      ['log', ['app ready', '{build: 42}']],
      ['warn', ['signing in']],
      [
        'error',
        ['Failed to load resource: the server responded with a status of 401 (Unauthorized)'],
      ],
      ['error', ['login failed', 'Invalid password']],
    ]);

    const network = api.stream(ulid, 'network');
    const login = network.find((line) => String(line.url).endsWith('/api/login'));
    expect(login).toMatchObject({ kind: 'fetch', method: 'POST', status: 401 });
    const headers = login?.requestHeaders as Record<string, string>;
    expect(headers.Authorization).toBe('PROBARA_REDACTED');
    const body = login?.requestBody as { text: string };
    expect(JSON.parse(body.text)).toEqual({
      email: 'ada@example.com',
      password: 'PROBARA_REDACTED',
    });
    expect(JSON.stringify(network)).not.toContain('secret-token-123');
    expect(JSON.stringify(network)).not.toContain('hunter2');
    expect(JSON.stringify(network)).not.toContain('abc123');

    const events = api.stream(ulid, 'events');
    expect(events.map((line) => line.type)).toEqual([
      'navigation',
      'input',
      'input',
      'click',
      'navigation',
    ]);
    expect(events[1]).toMatchObject({ target: { selector: '#email' }, value: '***************' });
    expect(events[2]).toMatchObject({ target: { selector: '#password' } });
    expect(events[2]).not.toHaveProperty('value');
    expect(events[3]).toMatchObject({ target: { selector: '#go' } });
    expect(String(events[4]?.url)).toMatch(/\/done$/);
    expect(JSON.stringify(events)).not.toContain('hunter2');

    const all = [...consoleLines, ...network, ...events];
    for (const line of all) {
      expect(line.t).toBeGreaterThanOrEqual(0);
      expect(line.t).toBeLessThan(10_000);
      expect(Number.isInteger(line.ts)).toBe(true);
    }
  });

  it('names a trace it cannot read, and sends neither the video nor anything else', async () => {
    const result = await probara([
      'vis',
      'create',
      fixturePath('vis', 'recording.webm'),
      '--playwright-trace',
      'broken.zip',
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('broken.zip: is not a Playwright trace: not a ZIP archive');
    expect(api.requests()).toHaveLength(0);
  });

  it('refuses a trace for a screenshot, which has no timeline', async () => {
    const result = await probara([
      'vis',
      'create',
      'screen.png',
      '--playwright-trace',
      fixturePath('vis', 'trace.zip'),
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--playwright-trace goes with a video');
    expect(api.requests()).toHaveLength(0);
  });
});
