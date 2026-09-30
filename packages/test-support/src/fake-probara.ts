/**
 * A fake Probara API over real HTTP (127.0.0.1, ephemeral port) for end-to-end tests of the
 * adapters (the CLI, the Playwright reporter).
 *
 * It implements the routes core calls: reports, run creation, run close, and the stage and commit
 * of result attachments. It keeps runs and automation keys in memory, logs every request in arrival
 * order, and answers scripted failures (status, body, headers such as `Retry-After`) by route. Like
 * the server, it refuses a run creation without `caseUlids`, `planUlid` or `automated: true`.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  CommitAttachmentsRequest,
  CreateRunRequest,
  ReportRequest,
  ReportResponse,
  StagedAttachment,
} from '@probara/core';

export type FakeRoute = 'report' | 'createRun' | 'closeRun' | 'stage' | 'commit';

/** An answer the fake sends instead of its normal one. */
export interface FakeReply {
  status: number;
  /** Defaults to `{ error: { code, message } }` with a code that fits the status. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** A file of a stage request (multipart `file` part). */
export interface FakeStagedFile {
  name: string;
  type: string;
  size: number;
  /** The SHA-256 of the content, in hex: whether the bytes arrived intact. */
  sha256: string;
}

export interface FakeRequest {
  /** `unknown` for a route the fake does not implement (answered 404). */
  route: FakeRoute | 'unknown';
  method: string;
  path: string;
  /** Lowercase header names. */
  headers: Readonly<Record<string, string>>;
  /** The JSON body, the staged files of a stage request, or `undefined`. */
  body: unknown;
  projectId?: string | undefined;
  runUlid?: string | undefined;
  resultUlid?: string | undefined;
}

export interface FakeRun {
  ulid: string;
  displayId: string;
  projectId: string;
  name: string;
  state: 'open' | 'closed';
  source?: unknown;
  /** Result ULIDs recorded in the run, in order. */
  results: string[];
}

export interface FailOptions {
  /** The first request of the route (1-based, retries included) that fails. Defaults to 1. */
  from?: number;
  /** How many requests fail from there. Defaults to every later one. */
  times?: number;
}

export interface FakeProbara {
  /** Such as `http://127.0.0.1:53123`: pass it as `PROBARA_BASE_URL` or `--base-url`. */
  readonly baseUrl: string;
  /** Every request, in arrival order. */
  readonly requests: readonly FakeRequest[];
  /** The requests of one route, in arrival order. */
  requestsTo(route: FakeRoute): FakeRequest[];
  /** The bodies of the report requests, in arrival order. */
  reports(): ReportRequest[];
  /** The files of every stage request, in arrival order. */
  stagedFiles(): FakeStagedFile[];
  /** A run the fake knows, by ULID. */
  run(ulid: string): FakeRun | undefined;
  /** Runs the fake created or was seeded with, in creation order. */
  runs(): FakeRun[];
  /** Adds a run (open by default) as if it had been created before; returns its ULID. */
  seedRun(options?: { projectId?: string; state?: 'open' | 'closed'; ulid?: string }): string;
  /** Answers requests of `route` with `reply` (see {@link FailOptions}). */
  fail(route: FakeRoute, reply: FakeReply, options?: FailOptions): void;
  close(): Promise<void>;
}

export interface FakeProbaraOptions {
  /** The token every request must carry as `Authorization: Bearer <token>` (401 otherwise). */
  token?: string;
}

interface Script {
  reply: FakeReply;
  from: number;
  until: number;
}

const DEFAULT_CODES: Readonly<Record<number, string>> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'file_too_large',
  422: 'validation_failed',
  429: 'too_many_requests',
};

/** The server's 422 message for a create-run body without cases, plan or `automated: true`. */
const CASES_REQUIRED = 'caseUlids is required unless planUlid is supplied or automated is true';

/** A valid ULID made of a prefix (Crockford letters: no I, L, O or U) and a counter. */
function ulidOf(prefix: string, index: number): string {
  return `01K${prefix}${String(index).padStart(23 - prefix.length, '0')}`;
}

function errorBody(status: number, message: string): unknown {
  const code = DEFAULT_CODES[status] ?? (status >= 500 ? 'internal_error' : 'validation_failed');
  return { error: { code, message } };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, reply: FakeReply): void {
  const body = JSON.stringify(reply.body ?? errorBody(reply.status, 'Scripted failure'));
  response.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
  response.end(body);
}

async function stagedFilesOf(raw: Buffer, contentType: string): Promise<FakeStagedFile[]> {
  const response = new Response(raw, { headers: { 'content-type': contentType } });
  // Deprecated for untrusted servers; here it only reads what core's own FormData wrote.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const form = await response.formData();
  const files = form.getAll('file').filter((part) => typeof part !== 'string');
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      sha256: createHash('sha256')
        .update(new Uint8Array(await file.arrayBuffer()))
        .digest('hex'),
    })),
  );
}

/** Starts a fake Probara on an ephemeral port of 127.0.0.1. */
export async function startFakeProbara(options: FakeProbaraOptions = {}): Promise<FakeProbara> {
  const requests: FakeRequest[] = [];
  const scripts = new Map<FakeRoute, Script[]>();
  const counts = new Map<FakeRoute, number>();
  const runs = new Map<string, FakeRun>();
  /** Automation keys of existing cases, per project. */
  const cases = new Map<string, Set<string>>();
  let runCount = 0;
  let resultCount = 0;
  let caseCount = 0;
  let refCount = 0;

  function newRun(projectId: string, name: string, source?: unknown): FakeRun {
    runCount += 1;
    const run: FakeRun = {
      ulid: ulidOf('RN', runCount),
      displayId: `R-${runCount}`,
      projectId,
      name,
      state: 'open',
      ...(source === undefined ? {} : { source }),
      results: [],
    };
    runs.set(run.ulid, run);
    return run;
  }

  function scripted(route: FakeRoute): FakeReply | undefined {
    const number = (counts.get(route) ?? 0) + 1;
    counts.set(route, number);
    return scripts.get(route)?.find((script) => number >= script.from && number < script.until)
      ?.reply;
  }

  function runReply(run: FakeRun) {
    return { ulid: run.ulid, displayId: run.displayId, state: run.state, name: run.name };
  }

  function report(projectId: string, body: ReportRequest): FakeReply {
    let run: FakeRun;
    if ('ulid' in body.run) {
      const existing = runs.get(body.run.ulid);
      if (existing === undefined) return { status: 404 };
      if (existing.state === 'closed') {
        return { status: 409, body: errorBody(409, 'The run is closed') };
      }
      run = existing;
    } else {
      run = newRun(projectId, body.run.name, body.run.source);
    }
    const keys = cases.get(projectId) ?? new Set<string>();
    cases.set(projectId, keys);
    const createMissing = body.options?.createMissingCases !== false;
    const response: ReportResponse = {
      run: { ulid: run.ulid, displayId: run.displayId, state: run.state },
      results: [],
      summary: { recorded: 0, created: 0, unmatched: 0 },
    };
    for (const entry of body.results) {
      const key = entry.automationKey ?? '';
      const known = entry.caseDisplayId !== undefined || keys.has(key);
      if (!known && !createMissing) {
        response.results.push({ outcome: 'unmatched', reason: 'case_not_found' });
        response.summary.unmatched += 1;
        continue;
      }
      if (!known) {
        keys.add(key);
        caseCount += 1;
        response.summary.created += 1;
      }
      resultCount += 1;
      const resultUlid = ulidOf('RS', resultCount);
      run.results.push(resultUlid);
      response.results.push({
        outcome: 'recorded',
        caseUlid: ulidOf('CS', caseCount),
        resultUlid,
        ...(known ? {} : { created: true as const }),
      });
      response.summary.recorded += 1;
    }
    if (body.options?.close === true) run.state = 'closed';
    response.run.state = run.state;
    return { status: 201, body: response };
  }

  function createRun(projectId: string, body: CreateRunRequest): FakeReply {
    // Like the server: a run needs cases, a plan to seed them from, or `automated: true`.
    if (body.caseUlids === undefined && body.planUlid === undefined && body.automated !== true) {
      return { status: 422, body: errorBody(422, CASES_REQUIRED) };
    }
    const run = newRun(projectId, body.name, body.source);
    return { status: 201, body: runReply(run) };
  }

  function closeRun(runUlid: string): FakeReply {
    const run = runs.get(runUlid);
    if (run === undefined) return { status: 404 };
    if (run.state === 'closed') return { status: 409, body: errorBody(409, 'The run is closed') };
    run.state = 'closed';
    return { status: 200, body: runReply(run) };
  }

  function stage(runUlid: string, files: readonly FakeStagedFile[]): FakeReply {
    const run = runs.get(runUlid);
    if (run === undefined) return { status: 404 };
    if (run.state === 'closed') return { status: 409, body: errorBody(409, 'The run is closed') };
    const attachments: StagedAttachment[] = files.map((file) => {
      refCount += 1;
      return {
        ulid: ulidOf('AT', refCount),
        objectKey: `staging/${refCount}`,
        mime: file.type,
        byteSize: file.size,
        originalFilename: file.name,
        disposition: 'attachment',
        thumbKey: null,
        width: null,
        height: null,
      };
    });
    return { status: 200, body: { attachments } };
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://fake').pathname);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers[name] = value;
    }
    const raw = await readBody(request);
    const contentType = headers['content-type'] ?? '';
    const json = (): unknown => JSON.parse(raw.toString('utf8')) as unknown;

    const match = (pattern: RegExp) => pattern.exec(path);
    const reportPath = match(/^\/api\/v1\/projects\/([^/]+)\/reports$/);
    const runsPath = match(/^\/api\/v1\/projects\/([^/]+)\/runs$/);
    const closePath = match(/^\/api\/v1\/runs\/([^/]+)\/close$/);
    const stagePath = match(/^\/api\/v1\/runs\/([^/]+)\/results\/([^/]+)\/attachments:stage$/);
    const commitPath = match(/^\/api\/v1\/runs\/([^/]+)\/results\/([^/]+)\/attachments$/);

    let entry: FakeRequest;
    if (method === 'POST' && reportPath !== null) {
      entry = { route: 'report', method, path, headers, body: json(), projectId: reportPath[1] };
    } else if (method === 'POST' && runsPath !== null) {
      entry = { route: 'createRun', method, path, headers, body: json(), projectId: runsPath[1] };
    } else if (method === 'POST' && closePath !== null) {
      entry = { route: 'closeRun', method, path, headers, body: json(), runUlid: closePath[1] };
    } else if (method === 'POST' && stagePath !== null) {
      entry = {
        route: 'stage',
        method,
        path,
        headers,
        body: await stagedFilesOf(raw, contentType),
        runUlid: stagePath[1],
        resultUlid: stagePath[2],
      };
    } else if (method === 'PATCH' && commitPath !== null) {
      entry = {
        route: 'commit',
        method,
        path,
        headers,
        body: json(),
        runUlid: commitPath[1],
        resultUlid: commitPath[2],
      };
    } else {
      entry = { route: 'unknown', method, path, headers, body: undefined };
    }
    requests.push(entry);

    if (entry.route === 'unknown') {
      send(response, { status: 404 });
      return;
    }
    if (options.token !== undefined && headers.authorization !== `Bearer ${options.token}`) {
      send(response, { status: 401 });
      return;
    }
    const failure = scripted(entry.route);
    if (failure !== undefined) {
      send(response, failure);
      return;
    }
    switch (entry.route) {
      case 'report':
        send(response, report(entry.projectId ?? '', entry.body as ReportRequest));
        return;
      case 'createRun':
        send(response, createRun(entry.projectId ?? '', entry.body as CreateRunRequest));
        return;
      case 'closeRun':
        send(response, closeRun(entry.runUlid ?? ''));
        return;
      case 'stage':
        send(response, stage(entry.runUlid ?? '', entry.body as FakeStagedFile[]));
        return;
      case 'commit':
        send(response, {
          status: 200,
          body: { attachments: (entry.body as CommitAttachmentsRequest).attachments },
        });
        return;
    }
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, { status: 500, body: errorBody(500, String(error)) });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    requestsTo: (route) => requests.filter((request) => request.route === route),
    reports: () =>
      requests
        .filter((request) => request.route === 'report')
        .map((request) => request.body as ReportRequest),
    stagedFiles: () =>
      requests
        .filter((request) => request.route === 'stage')
        .flatMap((request) => request.body as FakeStagedFile[]),
    run: (ulid) => runs.get(ulid),
    runs: () => [...runs.values()],
    seedRun({ projectId = 'PRB', state = 'open', ulid } = {}) {
      const run = newRun(projectId, 'Seeded run');
      run.state = state;
      if (ulid !== undefined) {
        runs.delete(run.ulid);
        run.ulid = ulid;
        runs.set(ulid, run);
      }
      return run.ulid;
    },
    fail(route, reply, { from = 1, times = Number.POSITIVE_INFINITY } = {}) {
      scripts.set(route, [...(scripts.get(route) ?? []), { reply, from, until: from + times }]);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}
