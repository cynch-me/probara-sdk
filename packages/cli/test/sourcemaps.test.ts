import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { configuredEnv, runCli, TOKEN } from './support/run-cli.js';

const workspace = mkdtempSync(join(tmpdir(), 'probara-cli-sourcemaps-'));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64.charAt(digit);
  } while (rest > 0);
  return out;
}

/** Mappings of one generated line per entry: [generated column, original line, original column]. */
function mappingsOf(lines: readonly (readonly (readonly [number, number, number])[])[]): string {
  let line = 0;
  let column = 0;
  return lines
    .map((segments) => {
      let generated = 0;
      return segments
        .map(([at, originalLine, originalColumn]) => {
          const text =
            vlq(at - generated) + vlq(0) + vlq(originalLine - line) + vlq(originalColumn - column);
          generated = at;
          line = originalLine;
          column = originalColumn;
          return text;
        })
        .join(',');
    })
    .join(';');
}

const ORIGINAL = [
  'export function total(items: string[]): number {',
  "  if (items.length === 0) throw new Error('empty cart');",
  '  return items.length;',
  '}',
  'total([]);',
].join('\n');

/** Where \`needle\` starts in \`text\`, as [line, column], from 0. */
function positionOf(text: string, needle: string): [number, number] {
  const index = text.indexOf(needle);
  if (index === -1) throw new Error(needle + ' is not in the text');
  const before = text.slice(0, index).split('\n');
  return [before.length - 1, before.at(-1)?.length ?? 0];
}

/**
 * A minified bundle of ORIGINAL with its map, as a bundler writes them: \`prefix\` lines before the
 * code (a hashbang), a "use strict" directive, and a probe that prints what the snippet registered.
 */
function bundle(name: string, prefix: string) {
  const probe =
    'process.stdout.write(JSON.stringify({ids:globalThis._probaraDebugIds,strict:function(){return this===void 0}()}));';
  const code =
    '"use strict";' +
    probe +
    'function total(t){if(0===t.length)throw new Error("empty cart");return t.length}total([]);';
  const tokens: [string, string][] = [
    ['function total', 'export function total'],
    ['if(', 'if ('],
    ['throw ', 'throw '],
    ['new Error', 'new Error'],
    ['return ', 'return '],
    ['total([])', 'total([])'],
  ];
  const segments = tokens.map(([generated, original]) => {
    const [line, column] = positionOf(ORIGINAL, original);
    return [code.indexOf(generated), line, column] as const;
  });
  const prefixLines =
    prefix === ''
      ? []
      : prefix
          .split('\n')
          .slice(0, -1)
          .map(() => []);
  const map = {
    version: 3,
    file: name,
    sources: ['../src/checkout.ts'],
    sourcesContent: [ORIGINAL],
    names: [],
    mappings: mappingsOf([...prefixLines, segments]),
  };
  return { js: prefix + code + '\n//# sourceMappingURL=' + name + '.map\n', map };
}

function writeBundle(dir: string, name: string, prefix = '') {
  const { js, map } = bundle(name, prefix);
  mkdirSync(join(workspace, dir), { recursive: true });
  writeFileSync(join(workspace, dir, name), js);
  writeFileSync(join(workspace, dir, name + '.map'), JSON.stringify(map));
}

const read = (...parts: string[]) => readFileSync(join(workspace, ...parts), 'utf8');
const readMap = (...parts: string[]) =>
  JSON.parse(read(...parts)) as SourceMapPayload & { debug_id?: string };

/** Runs \`file\` with Node: what the probe printed and the position of the frame of \`total\`. */
function execute(file: string) {
  const run = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const frame = new RegExp('at total \\(.*?:(\\d+):(\\d+)\\)').exec(run.stderr);
  if (frame === null) throw new Error('no frame of total in: ' + run.stderr);
  return {
    probe: JSON.parse(run.stdout) as { ids?: Record<string, string>; strict: boolean },
    line: Number(frame[1]),
    column: Number(frame[2]),
  };
}

/** Where an entry of a map points in the original source. */
function originOf(entry: object) {
  const { originalSource, originalLine, originalColumn } = entry as Record<string, unknown>;
  return { originalSource, originalLine, originalColumn };
}

const DEBUG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('probara sourcemaps inject', () => {
  it('injects a debug ID that the bundle registers at runtime, and its stack frames still map to the original source', async () => {
    writeBundle('e2e/dist', 'checkout.js');
    const before = execute(join(workspace, 'e2e/dist/checkout.js'));
    const original = originOf(
      new SourceMap(readMap('e2e/dist/checkout.js.map')).findEntry(
        before.line - 1,
        before.column - 1,
      ),
    );

    const result = await runCli(['sourcemaps', 'inject', 'e2e/dist'], { cwd: workspace });

    expect(result.exitCode).toBe(0);
    const map = readMap('e2e/dist/checkout.js.map');
    expect(map.debug_id).toMatch(DEBUG_ID);
    const js = read('e2e/dist/checkout.js');
    expect(
      js.endsWith(`//# debugId=${map.debug_id ?? ''}\n//# sourceMappingURL=checkout.js.map\n`),
    ).toBe(true);
    expect(result.stderr).toContain(
      `[probara] Injected debug ID ${map.debug_id ?? ''} into e2e/dist/checkout.js`,
    );

    const after = execute(join(workspace, 'e2e/dist/checkout.js'));
    expect(after.probe.strict).toBe(true);
    const registered = Object.entries(after.probe.ids ?? {});
    expect(registered).toHaveLength(1);
    expect(registered[0]?.[0]).toContain(join(workspace, 'e2e/dist/checkout.js'));
    expect(registered[0]?.[1]).toBe(map.debug_id);
    expect(after.line).toBe(before.line);
    expect(after.column).toBeGreaterThan(before.column);
    const mapped = originOf(new SourceMap(map).findEntry(after.line - 1, after.column - 1));
    expect(mapped).toEqual(original);
    expect(mapped).toMatchObject({
      originalSource: expect.stringContaining('src/checkout.ts') as unknown,
      originalLine: 1,
      originalColumn: ORIGINAL.split('\n')[1]?.indexOf('new Error'),
    });
  });

  it('keeps a hashbang first and maps the frames of a bundle whose code starts on a later line', async () => {
    writeBundle('e2e-bin/dist', 'cli.cjs', '#!/usr/bin/env node\n');

    const result = await runCli(['sourcemaps', 'inject', 'e2e-bin/dist'], { cwd: workspace });

    expect(result.exitCode).toBe(0);
    expect(read('e2e-bin/dist/cli.cjs').startsWith('#!/usr/bin/env node\n"use strict";')).toBe(
      true,
    );
    const after = execute(join(workspace, 'e2e-bin/dist/cli.cjs'));
    expect(after.probe.strict).toBe(true);
    expect(after.line).toBe(2);
    expect(
      new SourceMap(readMap('e2e-bin/dist/cli.cjs.map')).findEntry(
        after.line - 1,
        after.column - 1,
      ),
    ).toMatchObject({
      originalLine: 1,
      originalColumn: ORIGINAL.split('\n')[1]?.indexOf('new Error'),
    });
  });

  it('is idempotent: a second run skips the injected files, and the same file always gets the same debug ID', async () => {
    writeBundle('twice/a', 'app.js');
    writeBundle('twice/b', 'app.js');
    await runCli(['sourcemaps', 'inject', 'twice/a'], { cwd: workspace });
    const injected = { js: read('twice/a/app.js'), map: read('twice/a/app.js.map') };

    const again = await runCli(['sourcemaps', 'inject', 'twice/a', 'twice/b', '--json'], {
      cwd: workspace,
    });

    expect(again.exitCode).toBe(0);
    expect({ js: read('twice/a/app.js'), map: read('twice/a/app.js.map') }).toEqual(injected);
    expect(read('twice/b/app.js')).toBe(injected.js);
    expect(JSON.parse(again.stdout)).toEqual({
      status: 'injected',
      files: [
        {
          file: 'twice/a/app.js',
          map: 'twice/a/app.js.map',
          debugId: readMap('twice/a/app.js.map').debug_id,
          outcome: 'already-injected',
        },
        {
          file: 'twice/b/app.js',
          map: 'twice/b/app.js.map',
          debugId: readMap('twice/a/app.js.map').debug_id,
          outcome: 'injected',
        },
      ],
    });
    expect(again.stderr).toContain('[probara] Injected 1 file; 1 already had a debug ID');
  });

  it('finds the map a sourceMappingURL names, and leaves files without a map alone', async () => {
    writeBundle('named/dist', 'main.js');
    const js = read('named/dist/main.js').replace(
      'sourceMappingURL=main.js.map',
      'sourceMappingURL=../maps/main.map',
    );
    writeFileSync(join(workspace, 'named/dist/main.js'), js);
    mkdirSync(join(workspace, 'named/maps'));
    writeFileSync(join(workspace, 'named/maps/main.map'), read('named/dist/main.js.map'));
    rmSync(join(workspace, 'named/dist/main.js.map'));
    writeFileSync(join(workspace, 'named/dist/plain.js'), 'console.log(1);\n');

    const result = await runCli(['sourcemaps', 'inject', 'named/dist'], { cwd: workspace });

    expect(result.exitCode).toBe(0);
    expect(readMap('named/maps/main.map').debug_id).toMatch(DEBUG_ID);
    expect(read('named/dist/plain.js')).toBe('console.log(1);\n');
  });

  it('writes nothing in a dry run, and says what it would inject', async () => {
    writeBundle('dry/dist', 'app.js');
    const js = read('dry/dist/app.js');

    const result = await runCli(['sourcemaps', 'inject', 'dry/dist', '--dry-run'], {
      cwd: workspace,
    });

    expect(result.exitCode).toBe(0);
    expect(read('dry/dist/app.js')).toBe(js);
    expect(readMap('dry/dist/app.js.map').debug_id).toBeUndefined();
    expect(result.stderr).toMatch(
      /\[probara\] Would inject debug ID [0-9a-f-]{36} into dry\/dist\/app\.js/,
    );
  });

  it('is a usage error (2) without a directory, or for one without a JavaScript file and its map', async () => {
    mkdirSync(join(workspace, 'nothing'));
    writeFileSync(join(workspace, 'nothing/readme.md'), '# no bundle');

    const missing = await runCli(['sourcemaps', 'inject'], { cwd: workspace });
    const empty = await runCli(['sourcemaps', 'inject', 'nothing'], { cwd: workspace });

    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('The directory of the built files is missing');
    expect(empty.exitCode).toBe(2);
    expect(empty.stderr).toContain('nothing holds no .js, .mjs or .cjs file with a source map');
  });

  it('fails (1) on a map it cannot read, and still injects the other files', async () => {
    writeBundle('broken/dist', 'good.js');
    writeBundle('broken/dist', 'bad.js');
    writeFileSync(join(workspace, 'broken/dist/bad.js.map'), '{not json');
    const bad = read('broken/dist/bad.js');

    const result = await runCli(['sourcemaps', 'inject', 'broken/dist'], { cwd: workspace });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[probara] broken/dist/bad.js.map is not a source map');
    expect(read('broken/dist/bad.js')).toBe(bad);
    expect(readMap('broken/dist/good.js.map').debug_id).toMatch(DEBUG_ID);
  });
});

interface Received {
  method: string;
  url: URL;
  headers: Headers;
  body: Buffer;
}

function fakeFetch(answer: (request: Received, index: number) => Response) {
  const received: Received[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const entry = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: Buffer.from(await request.arrayBuffer()),
    };
    received.push(entry);
    return answer(entry, received.length - 1);
  };
  return { fetch, received };
}

const created = () => new Response(JSON.stringify({ debugId: 'x' }), { status: 201 });

async function injected(dir: string, names: string[]) {
  for (const name of names) writeBundle(dir, name);
  await runCli(['sourcemaps', 'inject', dir], { cwd: workspace });
}

describe('probara sourcemaps upload', () => {
  it('puts each injected map, gzipped, under its debug ID with the release and the URL of its file', async () => {
    await injected('up/dist', ['app.js']);
    mkdirSync(join(workspace, 'up/dist/chunks'));
    writeBundle('up/dist/chunks', 'cart.js');
    await runCli(['sourcemaps', 'inject', 'up/dist/chunks'], { cwd: workspace });
    const { fetch, received } = fakeFetch(created);

    const result = await runCli(
      ['sourcemaps', 'upload', 'up/dist', '--release', 'shop@1.4.2', '--url-prefix', '~/assets'],
      { cwd: workspace, env: configuredEnv('https://probara.test'), fetch },
    );

    expect(result.exitCode).toBe(0);
    const appId = readMap('up/dist/app.js.map').debug_id ?? '';
    const cartId = readMap('up/dist/chunks/cart.js.map').debug_id ?? '';
    const requests = received
      .map((request) => ({
        method: request.method,
        path: request.url.pathname,
        release: request.url.searchParams.get('release'),
        url: request.url.searchParams.get('url'),
        authorization: request.headers.get('authorization'),
        encoding: request.headers.get('content-encoding'),
        type: request.headers.get('content-type'),
        map: JSON.parse(gunzipSync(request.body).toString('utf8')) as { debug_id?: string },
      }))
      .sort((a, b) => (a.url ?? '').localeCompare(b.url ?? ''));
    expect(requests).toEqual([
      {
        method: 'PUT',
        path: '/api/v1/projects/PRB/error-monitoring/source-maps/' + appId,
        release: 'shop@1.4.2',
        url: '~/assets/app.js',
        authorization: 'Bearer ' + TOKEN,
        encoding: 'gzip',
        type: 'application/json',
        map: readMap('up/dist/app.js.map'),
      },
      {
        method: 'PUT',
        path: '/api/v1/projects/PRB/error-monitoring/source-maps/' + cartId,
        release: 'shop@1.4.2',
        url: '~/assets/chunks/cart.js',
        authorization: 'Bearer ' + TOKEN,
        encoding: 'gzip',
        type: 'application/json',
        map: readMap('up/dist/chunks/cart.js.map'),
      },
    ]);
    expect(result.stderr).toContain('[probara] Uploaded 2 source maps for release shop@1.4.2');
    expect(result.stderr).not.toContain(TOKEN);
  });

  it('retries a 5xx, and waits the Retry-After of a 429, before giving up', async () => {
    await injected('retry/dist', ['app.js']);
    const waits: number[] = [];
    const { fetch, received } = fakeFetch((_request, index) =>
      index === 0
        ? new Response('', { status: 503 })
        : index === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
          : created(),
    );

    const result = await runCli(['sourcemaps', 'upload', 'retry/dist', '--release', '1.0.0'], {
      cwd: workspace,
      env: configuredEnv('https://probara.test'),
      fetch,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    expect(result.exitCode).toBe(0);
    expect(received).toHaveLength(3);
    expect(waits[1]).toBe(7000);
    expect(result.stderr).toContain('got 503; retrying');
  });

  it('fails (1) when Probara refuses a map, and still uploads the others', async () => {
    await injected('refused/dist', ['a.js', 'b.js']);
    const refusedId = readMap('refused/dist/b.js.map').debug_id ?? '';
    const { fetch, received } = fakeFetch((request) =>
      request.url.pathname.endsWith(refusedId)
        ? new Response(
            JSON.stringify({ error: { code: 'payload_too_large', message: 'over 25 MB' } }),
            { status: 413 },
          )
        : created(),
    );

    const result = await runCli(
      ['sourcemaps', 'upload', 'refused/dist', '--release', '1.0.0', '--json'],
      { cwd: workspace, env: configuredEnv('https://probara.test'), fetch },
    );

    expect(result.exitCode).toBe(1);
    expect(received).toHaveLength(2);
    expect(result.stderr).toContain(
      '[probara] Could not upload refused/dist/b.js.map: Probara answered 413 payload_too_large: over 25 MB',
    );
    expect(result.stderr).toContain(
      '[probara] Uploaded 1 of 2 source maps for release 1.0.0; 1 failed',
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      release: '1.0.0',
      uploaded: [{ file: 'refused/dist/a.js', url: '~/a.js' }],
      failed: [
        {
          file: 'refused/dist/b.js',
          url: '~/b.js',
          error: 'Probara answered 413 payload_too_large: over 25 MB',
        },
      ],
    });
  });

  it('sends nothing in a dry run, without a token, and lists what it would upload', async () => {
    await injected('dry-up/dist', ['app.js']);
    const { fetch, received } = fakeFetch(created);

    const result = await runCli(
      ['sourcemaps', 'upload', 'dry-up/dist', '--release', '2.0.0', '--dry-run'],
      {
        cwd: workspace,
        env: { PROBARA_PROJECT: 'PRB' },
        fetch,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(received).toHaveLength(0);
    expect(result.stdout).toBe(
      `${readMap('dry-up/dist/app.js.map').debug_id ?? ''} ~/app.js dry-up/dist/app.js.map\n`,
    );
    expect(result.stderr).toContain(
      '[probara] Dry run: 1 source map would be uploaded for release 2.0.0; nothing was sent',
    );
  });

  it('is a usage error (2) without --release, without the token, or without an injected map', async () => {
    writeBundle('plain/dist', 'app.js');
    const env = configuredEnv('https://probara.test');

    const noRelease = await runCli(['sourcemaps', 'upload', 'plain/dist'], { cwd: workspace, env });
    const noToken = await runCli(['sourcemaps', 'upload', 'plain/dist', '--release', '1'], {
      cwd: workspace,
      env: { PROBARA_PROJECT: 'PRB' },
    });
    const notInjected = await runCli(['sourcemaps', 'upload', 'plain/dist', '--release', '1'], {
      cwd: workspace,
      env,
    });

    expect(noRelease.exitCode).toBe(2);
    expect(noRelease.stderr).toContain('--release is required');
    expect(noToken.exitCode).toBe(2);
    expect(noToken.stderr).toContain('PROBARA_API_TOKEN is not set');
    expect(notInjected.exitCode).toBe(2);
    expect(notInjected.stderr).toContain(
      'plain/dist holds no source map with a debug ID: run probara sourcemaps inject first',
    );
  });
});

describe('the built bin', () => {
  it('injects through the published entry point', () => {
    writeBundle('bin/dist', 'app.js');
    const bin = join(import.meta.dirname, '../dist/cli.js');
    execFileSync(process.execPath, [bin, 'sourcemaps', 'inject', 'bin/dist'], { cwd: workspace });
    expect(readMap('bin/dist/app.js.map').debug_id).toMatch(DEBUG_ID);
  });
});
