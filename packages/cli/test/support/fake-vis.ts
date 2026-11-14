/**
 * A fake of the Vis endpoints of the Probara API (`/api/v1/vises`), in-process: a `fetch` the CLI
 * calls instead of the network. It keeps the Vises, their uploads and assets, and every request, so
 * a test asserts what was sent; failures are injected per request.
 */
import { gunzipSync } from 'node:zlib';

export const PART_SIZE = 8 * 1024 * 1024;

export interface FakeVis {
  ulid: string;
  visNumber: number;
  displayId: string;
  title: string;
  description: string | null;
  kind: string;
  source: string;
  status: string;
  pageUrl: string | null;
  pageTitle: string | null;
  environment: Record<string, unknown>;
  durationMs: number | null;
  capturedAt: number | null;
  metadata: Record<string, unknown> | null;
  creatorUlid: string | null;
  folderUlid: string | null;
  accessMode: string;
  linkSharing: string;
  canEdit: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StoredAsset {
  kind: string;
  contentType: string;
  contentEncoding: string | null;
  bytes: Uint8Array;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  bytes: Uint8Array;
  /** The JSON body, when there is one. */
  json: unknown;
}

interface Failure {
  method: string;
  path: RegExp;
  status: number;
  body: unknown;
  times: number;
}

interface Upload {
  uploadUlid: string;
  visUlid: string;
  kind: string;
  contentType: string;
  contentEncoding: string | null;
  parts: Map<number, Uint8Array>;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0;

/** A ULID that is unique within the test run. */
export function fakeUlid(): string {
  counter += 1;
  const tail = counter.toString(32).toUpperCase().padStart(10, '0');
  let head = '';
  for (let index = 0; index < 16; index += 1)
    head += CROCKFORD.charAt((counter * 7 + index * 3) % 32);
  return `01${head.slice(2)}${tail}`.slice(0, 26).replace(/[ILOU]/g, 'X');
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function error(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: { code, message, ...(details === undefined ? {} : { details }) } });
}

export function createFakeVisApi({
  token,
  now = 1_767_225_600_000,
  recordingMaxMinutes,
}: {
  token: string;
  now?: number;
  /** The plan's longest recording: finalize refuses a longer one, as Probara does. */
  recordingMaxMinutes?: number;
}) {
  const vises = new Map<string, FakeVis>();
  const assets = new Map<string, Map<string, StoredAsset>>();
  const uploads = new Map<string, Upload>();
  const requests: RecordedRequest[] = [];
  const failures: Failure[] = [];
  let nextNumber = 1;

  function seed(fields: Partial<FakeVis> = {}): FakeVis {
    const visNumber = fields.visNumber ?? nextNumber;
    nextNumber = Math.max(nextNumber, visNumber + 1);
    const vis: FakeVis = {
      ulid: fakeUlid(),
      visNumber,
      displayId: `VIS-${String(visNumber)}`,
      title: 'Checkout button does nothing',
      description: null,
      kind: 'video',
      source: 'extension',
      status: 'ready',
      pageUrl: null,
      pageTitle: null,
      environment: { country: null },
      durationMs: 42_000,
      capturedAt: null,
      metadata: null,
      creatorUlid: '01KC0000000000000000000001',
      folderUlid: null,
      accessMode: 'public',
      linkSharing: 'members',
      canEdit: true,
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    vises.set(vis.ulid, vis);
    return vis;
  }

  function assetOf(visUlid: string, kind: string, stored: StoredAsset) {
    let map = assets.get(visUlid);
    if (map === undefined) {
      map = new Map();
      assets.set(visUlid, map);
    }
    map.set(kind, stored);
    return {
      kind,
      contentType: stored.contentType,
      contentEncoding: stored.contentEncoding,
      byteSize: stored.bytes.byteLength,
      uploaderUlid: '01KC0000000000000000000001',
      createdAt: now,
      updatedAt: now,
    };
  }

  function route(request: RecordedRequest): Response {
    const { method, path, query } = request;
    const parts = path
      .replace(/^\/api\/v1\/vises/, '')
      .split('/')
      .filter(Boolean);
    if (parts.length === 0) {
      if (method === 'GET') {
        const status = query.get('status') ?? 'ready';
        let items = [...vises.values()].filter((vis) => vis.status === status);
        for (const name of ['kind', 'source'] as const) {
          const value = query.get(name);
          if (value !== null) items = items.filter((vis) => vis[name] === value);
        }
        const creator = query.get('creator');
        if (creator !== null) items = items.filter((vis) => vis.creatorUlid === creator);
        const folder = query.get('folder');
        if (folder !== null) {
          items = items.filter((vis) => vis.folderUlid === (folder === 'none' ? null : folder));
        }
        const q = query.get('q');
        if (q !== null) {
          items = items.filter((vis) => vis.title.toLowerCase().includes(q.toLowerCase()));
        }
        items.sort((a, b) => b.visNumber - a.visNumber);
        const page = Number(query.get('page') ?? '1');
        const pageSize = Number(query.get('pageSize') ?? '50');
        return json(200, {
          items: items.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: items.length,
        });
      }
      if (method === 'POST') {
        const body = request.json as Record<string, unknown>;
        if (typeof body.title !== 'string' || body.title.trim() === '') {
          return error(422, 'validation_failed', 'title is required');
        }
        if (body.source !== 'cli' && body.source !== 'upload') {
          return error(422, 'validation_failed', 'unexpected source');
        }
        const vis = seed({
          title: body.title,
          kind: String(body.kind),
          source: body.source,
          status: 'pending',
          description: (body.description as string | undefined) ?? null,
          pageUrl: (body.pageUrl as string | undefined) ?? null,
          pageTitle: (body.pageTitle as string | undefined) ?? null,
          environment: (body.environment as Record<string, unknown> | undefined) ?? {},
          capturedAt: (body.capturedAt as number | undefined) ?? null,
          durationMs: (body.durationMs as number | undefined) ?? null,
          folderUlid: (body.folderUlid as string | undefined) ?? null,
          metadata: (body.metadata as Record<string, unknown> | undefined) ?? null,
          accessMode: (body.accessMode as string | undefined) ?? 'public',
        });
        return json(201, vis);
      }
    }
    if (parts[0] === 'by-display-id' && method === 'GET') {
      const vis = [...vises.values()].find((item) => item.displayId === parts[1]);
      return vis === undefined ? error(404, 'not_found', 'Vis not found') : json(200, vis);
    }
    const vis = vises.get(parts[0] ?? '');
    if (vis === undefined) return error(404, 'not_found', 'Vis not found');
    const [, child, uploadUlid, partsWord, partNumber] = parts;
    if (child === undefined) {
      if (method === 'GET') return json(200, vis);
      if (method === 'DELETE') {
        vises.delete(vis.ulid);
        assets.delete(vis.ulid);
        return new Response(null, { status: 204 });
      }
      if (method === 'PATCH') {
        const body = request.json as Record<string, unknown>;
        if (typeof body.title === 'string') vis.title = body.title;
        if ('description' in body) vis.description = body.description as string | null;
        if ('folderUlid' in body) vis.folderUlid = body.folderUlid as string | null;
        return json(200, vis);
      }
    }
    if (child === 'access' && method === 'PATCH') {
      vis.accessMode = (request.json as { mode: string }).mode;
      return json(200, {
        mode: vis.accessMode,
        creatorUlid: vis.creatorUlid,
        grantedCount: 0,
        revokedCount: 0,
      });
    }
    if (child === 'assets' && method === 'PUT' && uploadUlid !== undefined) {
      return json(
        200,
        assetOf(vis.ulid, uploadUlid, {
          kind: uploadUlid,
          contentType: request.headers['content-type'] ?? '',
          contentEncoding: request.headers['content-encoding'] ?? null,
          bytes: request.bytes,
        }),
      );
    }
    if (child === 'uploads') {
      if (uploadUlid === undefined && method === 'POST') {
        const body = request.json as {
          kind: string;
          contentType: string;
          contentEncoding?: string;
        };
        // Starting an upload of a kind abandons the open one of the same kind.
        for (const open of [...uploads.values()]) {
          if (open.visUlid === vis.ulid && open.kind === body.kind) uploads.delete(open.uploadUlid);
        }
        const upload: Upload = {
          uploadUlid: fakeUlid(),
          visUlid: vis.ulid,
          kind: body.kind,
          contentType: body.contentType,
          contentEncoding: body.contentEncoding ?? null,
          parts: new Map(),
        };
        uploads.set(upload.uploadUlid, upload);
        return json(201, {
          uploadUlid: upload.uploadUlid,
          kind: body.kind,
          contentType: body.contentType,
          contentEncoding: upload.contentEncoding,
          partSize: PART_SIZE,
          maxBytes: 30 * 64 * 1024 * 1024,
          receivedParts: [],
          createdAt: now,
        });
      }
      const upload = uploads.get(uploadUlid ?? '');
      if (upload === undefined) return error(404, 'not_found', 'Upload not found');
      if (partsWord === 'parts' && method === 'PUT') {
        upload.parts.set(Number(partNumber), request.bytes);
        return json(200, {
          uploadUlid: upload.uploadUlid,
          partNumber: Number(partNumber),
          byteSize: request.bytes.byteLength,
        });
      }
      if (partsWord === 'complete' && method === 'POST') {
        const numbers = [...upload.parts.keys()].sort((a, b) => a - b);
        const chunks = numbers.map((number) => upload.parts.get(number) ?? new Uint8Array());
        const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        uploads.delete(upload.uploadUlid);
        return json(
          200,
          assetOf(vis.ulid, upload.kind, {
            kind: upload.kind,
            contentType: upload.contentType,
            contentEncoding: upload.contentEncoding,
            bytes,
          }),
        );
      }
      if (partsWord === undefined && method === 'DELETE') {
        uploads.delete(upload.uploadUlid);
        return new Response(null, { status: 204 });
      }
    }
    if (child === 'finalize' && method === 'POST') {
      if (vis.status !== 'pending') return error(409, 'conflict', 'The Vis is not pending');
      const body = request.json as { durationMs?: number };
      const durationMs = body.durationMs ?? vis.durationMs;
      if (
        recordingMaxMinutes !== undefined &&
        durationMs !== null &&
        durationMs > recordingMaxMinutes * 60_000
      ) {
        return error(422, 'validation_failed', 'The recording is longer than the plan allows', {
          reason: 'recording_too_long',
          recordingMaxMinutes,
        });
      }
      const required = vis.kind;
      if (assets.get(vis.ulid)?.has(required) !== true) {
        return error(422, 'validation_failed', 'The Vis has no media', {
          reason: 'required_asset_missing',
        });
      }
      if (body.durationMs !== undefined) vis.durationMs = body.durationMs;
      vis.status = 'ready';
      return json(200, vis);
    }
    return error(404, 'not_found', `No route ${method} ${path}`);
  }

  const fetchFake: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = init?.body;
    const bytes =
      body === undefined || body === null
        ? new Uint8Array()
        : new Uint8Array(await new Response(body).arrayBuffer());
    let parsed: unknown;
    if (headers['content-type'] === 'application/json') {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    }
    const request: RecordedRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers,
      bytes,
      json: parsed,
    };
    requests.push(request);
    if (headers.authorization !== `Bearer ${token}`) {
      return error(401, 'unauthorized', 'Invalid API token');
    }
    const failure = failures.find(
      (item) => item.times > 0 && item.method === method && item.path.test(url.pathname),
    );
    if (failure !== undefined) {
      failure.times -= 1;
      return json(failure.status, failure.body);
    }
    return route(request);
  };

  return {
    fetch: fetchFake,
    seed,
    vis: (ulid: string) => vises.get(ulid),
    vises: () => [...vises.values()],
    asset: (visUlid: string, kind: string) => assets.get(visUlid)?.get(kind),
    /** The NDJSON lines of a gzip-compressed diagnostics stream, parsed. */
    stream: (visUlid: string, kind: string): Record<string, unknown>[] => {
      const stored = assets.get(visUlid)?.get(kind);
      if (stored === undefined) return [];
      return new TextDecoder()
        .decode(gunzipSync(stored.bytes))
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    /** Uploads still open (neither completed nor aborted). */
    openUploads: () => uploads.size,
    requests: () => [...requests],
    requestsTo: (method: string, path: RegExp) =>
      requests.filter((request) => request.method === method && path.test(request.path)),
    /** The next `times` requests matching `method` and `path` answer `status` with `body`. */
    fail(method: string, path: RegExp, status: number, body: unknown, times = 1) {
      failures.push({ method, path, status, body, times });
    },
  };
}

export type FakeVisApi = ReturnType<typeof createFakeVisApi>;
