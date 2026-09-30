/**
 * A fake Probara API over real HTTP (127.0.0.1, ephemeral port) for end-to-end tests of the
 * adapters (the CLI, the Playwright reporter).
 *
 * It implements the routes core calls: reports, run creation, run close, the stage and commit of
 * result attachments, and the case keys of a run (from the cases a run was seeded with). It keeps runs and automation keys in memory, logs every request in arrival
 * order, and answers scripted failures (status, body, headers such as `Retry-After`) by route. Like
 * the server, it refuses a run creation without `caseUlids`, `planUlid`, `plan` or
 * `automated: true`, leaves an entry whose case id belongs to another project unmatched
 * (`invalid_display_id`), refuses with 422 a body the server refuses (see `report-contract.ts`:
 * strict fields, limits, per-report totals, both forms of a run reference) and a commit whose
 * `stepIndex` names no step of its result, and answers `warnings` for the case fields it cannot
 * resolve. With `members`, it assigns the failed results of a report to the members its
 * `options.assignFailedTo` names, in turn, and counts the others in a warning, like the server.
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
import { caseFieldWarnings, countSteps, createRunIssues, reportIssues } from './report-contract.js';

export type FakeRoute = 'report' | 'createRun' | 'closeRun' | 'stage' | 'commit' | 'caseKeys';

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

/** A case of a run, as `GET /runs/{runUlid}/case-keys` answers it. */
export interface FakeRunCase {
  caseDisplayId: string;
  automationKey: string | null;
}

export interface FakeRun {
  ulid: string;
  displayId: string;
  projectId: string;
  name: string;
  state: 'open' | 'closed';
  source?: unknown;
  /** The body that created it: a report's `run`, or the body of `POST /runs`. */
  created?: unknown;
  /** Result ULIDs recorded in the run, in order. */
  results: string[];
  /** The cases of the run the case keys route answers: those it was seeded with. */
  cases: FakeRunCase[];
}

export interface FailOptions {
  /** The first request of the route (1-based, retries included) that fails. Defaults to 1. */
  from?: number;
  /** How many requests fail from there. Defaults to every later one. */
  times?: number;
}

/** A run case a report assigned (`options.assignFailedTo`): the case by its key or display id. */
export interface FakeAssignment {
  runUlid: string;
  automationKey?: string;
  caseDisplayId?: string;
  /** The member's email, lowercased like the server compares it. */
  email: string;
}

/** A case a report created, with the `case` of the entry that created it. */
export interface FakeCase {
  projectId: string;
  automationKey: string;
  title?: string | undefined;
  case?: unknown;
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
  /** The cases the reports created, in creation order. */
  createdCases(): FakeCase[];
  /** The run cases the reports assigned with `options.assignFailedTo`, in order. */
  assignments(): FakeAssignment[];
  /**
   * Adds a run (open by default) as if it had been created before, with `cases` for the case keys
   * route; returns its ULID.
   */
  seedRun(options?: {
    projectId?: string;
    state?: 'open' | 'closed';
    ulid?: string;
    cases?: readonly FakeRunCase[];
  }): string;
  /** Answers requests of `route` with `reply` (see {@link FailOptions}). */
  fail(route: FakeRoute, reply: FakeReply, options?: FailOptions): void;
  close(): Promise<void>;
}

export interface FakeProbaraOptions {
  /** The token every request must carry as `Authorization: Bearer <token>` (401 otherwise). */
  token?: string;
  /** Custom field titles a created case may set by name, besides the system fields. */
  customFields?: readonly string[];
  /**
   * Emails of the members `options.assignFailedTo` may name: any other is counted in the first
   * warning of the report. Without it, every email names a member.
   */
  members?: readonly string[];
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
const CASES_REQUIRED =
  'caseUlids is required unless planUlid or plan is supplied or automated is true';
/** The most warnings a report answers. */
const MAX_WARNINGS = 20;
/** Cases per page of the case keys route: its default and its most. */
const DEFAULT_CASE_KEYS_PAGE = 50;
const MAX_CASE_KEYS_PAGE = 200;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** The prefix of the cursors of the case keys route: `ulidOf(CURSOR, offset)`. */
const CURSOR = 'CK';

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
  const createdCases: FakeCase[] = [];
  const assignments: FakeAssignment[] = [];
  /** The steps each recorded result carries, by result ULID: what a `stepIndex` may name. */
  const stepCounts = new Map<string, number>();

  function newRun(projectId: string, name: string, source?: unknown, created?: unknown): FakeRun {
    runCount += 1;
    const run: FakeRun = {
      ulid: ulidOf('RN', runCount),
      displayId: `R-${runCount}`,
      projectId,
      name,
      state: 'open',
      ...(source === undefined ? {} : { source }),
      ...(created === undefined ? {} : { created }),
      results: [],
      cases: [],
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
    const [issue] = reportIssues(body);
    if (issue !== undefined) return { status: 422, body: errorBody(422, issue) };
    let run: FakeRun;
    if ('ulid' in body.run) {
      const existing = runs.get(body.run.ulid);
      if (existing === undefined) return { status: 404 };
      if (existing.state === 'closed') {
        return { status: 409, body: errorBody(409, 'The run is closed') };
      }
      run = existing;
    } else {
      run = newRun(projectId, body.run.name, body.run.source, body.run);
    }
    const warnings: string[] = [];
    const keys = cases.get(projectId) ?? new Set<string>();
    cases.set(projectId, keys);
    const createMissing = body.options?.createMissingCases !== false;
    const response: ReportResponse = {
      run: { ulid: run.ulid, displayId: run.displayId, state: run.state },
      results: [],
      summary: { recorded: 0, created: 0, unmatched: 0 },
    };
    for (const entry of body.results) {
      // Like the server: a case id of another project is no id of this one.
      if (entry.caseDisplayId !== undefined && !entry.caseDisplayId.startsWith(`${projectId}-`)) {
        response.results.push({ outcome: 'unmatched', reason: 'invalid_display_id' });
        response.summary.unmatched += 1;
        continue;
      }
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
        // Only the entry that creates the case applies its `case`.
        createdCases.push({ projectId, automationKey: key, title: entry.title, case: entry.case });
        for (const warning of caseFieldWarnings(entry.case?.fields, options.customFields ?? [])) {
          if (!warnings.includes(warning)) warnings.push(warning);
        }
      }
      resultCount += 1;
      const resultUlid = ulidOf('RS', resultCount);
      stepCounts.set(resultUlid, countSteps(entry.steps));
      run.results.push(resultUlid);
      response.results.push({
        outcome: 'recorded',
        caseUlid: ulidOf('CS', caseCount),
        resultUlid,
        ...(known ? {} : { created: true as const }),
      });
      response.summary.recorded += 1;
    }
    const assignWarning = assignFailed(run, body, response);
    if (assignWarning !== undefined) warnings.unshift(assignWarning);
    if (body.options?.close === true) run.state = 'closed';
    response.run.state = run.state;
    if (warnings.length > 0) response.warnings = warnings.slice(0, MAX_WARNINGS);
    return { status: 201, body: response };
  }

  /**
   * Assigns each case whose last recorded entry of the report failed, and which has no assignee in
   * the run yet, to the next member of `options.assignFailedTo` (the turn starts again with every
   * report). Returns the warning that counts the emails that match no member.
   */
  function assignFailed(
    run: FakeRun,
    body: ReportRequest,
    response: ReportResponse,
  ): string | undefined {
    const emails = body.options?.assignFailedTo;
    if (emails === undefined) return undefined;
    const distinct = [...new Set(emails.map((email) => email.trim().toLowerCase()))];
    const known = options.members?.map((email) => email.toLowerCase());
    const members = distinct.filter((email) => known === undefined || known.includes(email));
    const unmatched = distinct.length - members.length;
    const lastStatus = new Map<string, { status: string; entry: (typeof body.results)[number] }>();
    body.results.forEach((entry, index) => {
      if (response.results[index]?.outcome !== 'recorded') return;
      const key = entry.caseDisplayId ?? entry.automationKey ?? '';
      lastStatus.set(key, { status: entry.status, entry });
    });
    let turn = 0;
    for (const [key, { status, entry }] of lastStatus) {
      if (status !== 'failed' || members.length === 0) continue;
      const taken = assignments.some(
        (assignment) =>
          assignment.runUlid === run.ulid &&
          (assignment.caseDisplayId ?? assignment.automationKey) === key,
      );
      if (taken) continue;
      assignments.push({
        runUlid: run.ulid,
        ...(entry.caseDisplayId === undefined
          ? { automationKey: entry.automationKey ?? '' }
          : { caseDisplayId: entry.caseDisplayId }),
        email: members[turn % members.length] ?? '',
      });
      turn += 1;
    }
    return unmatched === 0
      ? undefined
      : `assignFailedTo: ${unmatched} of ${distinct.length} emails did not match a member who can be assigned in this project`;
  }

  function createRun(projectId: string, body: CreateRunRequest): FakeReply {
    const [issue] = createRunIssues(body);
    if (issue !== undefined) return { status: 422, body: errorBody(422, issue) };
    // Like the server: a run needs cases, a plan to seed them from, or `automated: true`.
    if (
      body.caseUlids === undefined &&
      body.planUlid === undefined &&
      body.plan === undefined &&
      body.automated !== true
    ) {
      return { status: 422, body: errorBody(422, CASES_REQUIRED) };
    }
    const run = newRun(projectId, body.name, body.source, body);
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

  function commit(resultUlid: string, body: CommitAttachmentsRequest): FakeReply {
    const { attachments } = body;
    if (attachments.length > 20) {
      return { status: 422, body: errorBody(422, 'A result holds at most 20 attachments') };
    }
    const steps = stepCounts.get(resultUlid) ?? 0;
    // Like the server: a `stepIndex` names a reported step of the result, else nothing is written.
    const wrong = attachments.find(
      (item) => typeof item.stepIndex === 'number' && item.stepIndex >= steps,
    );
    if (wrong !== undefined) {
      return {
        status: 422,
        body: errorBody(422, `stepIndex ${String(wrong.stepIndex)} is not a step of this result`),
      };
    }
    return { status: 200, body: { attachments } };
  }

  /**
   * One page of the cases of a run: `limit` (1..200, default 50) from the `cursor` of the previous
   * page, like the server's; the cursor encodes the offset of the next case.
   */
  function caseKeys(runUlid: string, query: URLSearchParams): FakeReply {
    const run = runs.get(runUlid);
    if (run === undefined) return { status: 404, body: errorBody(404, 'Run not found') };
    const limitText = query.get('limit');
    const limit = limitText === null ? DEFAULT_CASE_KEYS_PAGE : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CASE_KEYS_PAGE) {
      return { status: 422, body: errorBody(422, `limit must be an integer from 1 to 200`) };
    }
    const cursor = query.get('cursor');
    if (cursor !== null && !ULID.test(cursor)) {
      return { status: 422, body: errorBody(422, 'cursor is not a ULID') };
    }
    const prefix = `01K${CURSOR}`;
    const offset = cursor?.startsWith(prefix) === true ? Number(cursor.slice(prefix.length)) : 0;
    const items = run.cases.slice(offset, offset + limit);
    const next = offset + limit;
    return {
      status: 200,
      body: {
        items: items.map(({ caseDisplayId, automationKey }) => ({ caseDisplayId, automationKey })),
        nextCursor: next < run.cases.length ? ulidOf(CURSOR, next) : null,
      },
    };
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://fake');
    const path = decodeURIComponent(url.pathname);
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
    const caseKeysPath = match(/^\/api\/v1\/runs\/([^/]+)\/case-keys$/);

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
    } else if (method === 'GET' && caseKeysPath !== null) {
      entry = {
        route: 'caseKeys',
        method,
        path,
        headers,
        body: undefined,
        runUlid: caseKeysPath[1],
      };
    } else {
      entry = { route: 'unknown', method, path, headers, body: undefined };
    }
    requests.push(entry);

    if (entry.route === 'unknown') {
      send(response, { status: 404 });
      return;
    }
    const bearer = headers.authorization?.startsWith('Bearer ') === true;
    if (
      (options.token !== undefined && headers.authorization !== `Bearer ${options.token}`) ||
      (entry.route === 'caseKeys' && !bearer)
    ) {
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
        send(response, commit(entry.resultUlid ?? '', entry.body as CommitAttachmentsRequest));
        return;
      case 'caseKeys':
        send(response, caseKeys(entry.runUlid ?? '', url.searchParams));
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
    createdCases: () => [...createdCases],
    assignments: () => [...assignments],
    runs: () => [...runs.values()],
    seedRun({ projectId = 'PRB', state = 'open', ulid, cases = [] } = {}) {
      const run = newRun(projectId, 'Seeded run');
      run.state = state;
      run.cases = cases.map(({ caseDisplayId, automationKey }) => ({
        caseDisplayId,
        automationKey,
      }));
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
