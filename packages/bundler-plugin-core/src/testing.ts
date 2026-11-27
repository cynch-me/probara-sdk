import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const TOKEN = 'prb_test_T0KEN_must_never_leak_42';
export const PROJECT = 'SHOP';

export interface ReceivedUpload {
  debugId: string;
  release: string | null;
  url: string | null;
  authorization: string | undefined;
  map: Record<string, unknown>;
}

export interface FakeSourceMapApi {
  baseUrl: string;
  uploads: ReceivedUpload[];
  close: () => Promise<void>;
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeSourceMapApi(
  answer: { status: number; body?: unknown } = { status: 201 },
): Promise<FakeSourceMapApi> {
  const uploads: ReceivedUpload[] = [];
  const server = createServer((request, response) => {
    void bodyOf(request).then((body) => {
      const url = new URL(request.url ?? '/', 'http://fake');
      const match = new RegExp(
        `^/api/v1/projects/${PROJECT}/error-monitoring/source-maps/([^/]+)$`,
      ).exec(url.pathname);
      if (request.method !== 'PUT' || match?.[1] === undefined) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'not_found', message: 'No such route' } }));
        return;
      }
      uploads.push({
        debugId: decodeURIComponent(match[1]),
        release: url.searchParams.get('release'),
        url: url.searchParams.get('url'),
        authorization: request.headers.authorization,
        map: JSON.parse(gunzipSync(body).toString('utf8')) as Record<string, unknown>,
      });
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    uploads,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

export interface TempProject {
  dir: string;
  path: (relative: string) => string;
  write: (files: Readonly<Record<string, string>>) => Promise<void>;
  remove: () => Promise<void>;
}

export async function tempProject(prefix: string): Promise<TempProject> {
  const dir = await mkdtemp(join(tmpdir(), `probara-${prefix}-`));
  const path = (relative: string) => join(dir, relative);
  return {
    dir,
    path,
    write: async (files) => {
      for (const [relative, text] of Object.entries(files)) {
        await mkdir(dirname(path(relative)), { recursive: true });
        await writeFile(path(relative), text);
      }
    },
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

export const DEBUG_ID_COMMENT = /^\/\/# debugId=([0-9a-f-]{36})$/m;

export interface EmittedFile {
  file: string;
  code: string;
  debugId: string | undefined;
  hasMap: boolean;
  mapDebugId: unknown;
}

export const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

export async function emittedJavaScript(dir: string): Promise<EmittedFile[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(?:m|c)?js$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  const emitted: EmittedFile[] = [];
  for (const path of files) {
    const code = await readFile(path, 'utf8');
    const hasMap = await exists(`${path}.map`);
    const map = hasMap
      ? (JSON.parse(await readFile(`${path}.map`, 'utf8')) as Record<string, unknown>)
      : {};
    emitted.push({
      file: relative(dir, path).split(sep).join('/'),
      code,
      debugId: DEBUG_ID_COMMENT.exec(code)?.[1],
      hasMap,
      mapDebugId: map.debug_id,
    });
  }
  return emitted;
}

export const APP_SOURCES: Readonly<Record<string, string>> = {
  'src/total.js': [
    'export function total(items) {',
    "  if (items.length === 0) throw new Error('empty cart');",
    '  return items.length;',
    '}',
    '',
  ].join('\n'),
  'src/main.js': [
    "import { total } from './total.js';",
    'globalThis.probaraTestTotal = total;',
    '',
  ].join('\n'),
};
