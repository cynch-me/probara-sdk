import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CommitAttachmentsRequest,
  ReportRequest,
  ReportResponse,
  StagedAttachment,
} from './api.js';
import { buildAutomationKey } from './automation-key.js';
import type { Logger } from './logger.js';
import { createReporter, type ReporterOptions } from './reporter.js';
import type { TestResultInput } from './result.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const CREATED_RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SHARED_RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2X9';
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: BASE_URL };
const MIB = 1024 * 1024;

type Attachments = NonNullable<TestResultInput['attachments']>;

interface Part {
  name: string;
  type: string;
  size: number;
}

interface Stage {
  resultUlid: string;
  body: FormData;
  parts: Part[];
}

interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface ServerOptions {
  /** Answers the stage request with this number (1-based, attempts included). */
  stageFailures?: Record<number, Reply>;
  /** Answers the commit request with this number (1-based, attempts included). */
  commitFailures?: Record<number, Reply>;
  /** Answers every close request. */
  close?: Reply;
  /** Answers every report with this number (1-based, attempts included). */
  reportFailures?: Record<number, Reply>;
  /** Automation keys the server leaves unmatched. */
  unmatched?: readonly string[];
  /** Holds every stage response until this settles. */
  holdStages?: Promise<void>;
}

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function reply({ status, body, headers }: Reply): Response {
  return json(status, body, headers);
}

function ulidOf(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(26 - prefix.length, '0')}`;
}

/** A fake Probara: reports, stage, commit and close, with every request in arrival order. */
function fakeServer(options: ServerOptions = {}) {
  const events: string[] = [];
  const reports: ReportRequest[] = [];
  const stages: Stage[] = [];
  const commits: { resultUlid: string; body: CommitAttachmentsRequest; key: string | null }[] = [];
  const closes: { url: string; key: string | null }[] = [];
  let results = 0;
  let refs = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.slice(BASE_URL.length);
    const headers = new Headers(init.headers);
    const method = init.method ?? 'GET';

    if (method === 'POST' && path === '/api/v1/projects/SHOP/reports') {
      const body = JSON.parse(init.body as string) as ReportRequest;
      reports.push(body);
      events.push(`report close=${String(body.options?.close)}`);
      const failure = options.reportFailures?.[reports.length];
      if (failure !== undefined) return reply(failure);
      const ulid = 'ulid' in body.run ? body.run.ulid : CREATED_RUN;
      const response: ReportResponse = {
        run: { ulid, displayId: 'R-12', state: body.options?.close === true ? 'closed' : 'open' },
        results: body.results.map((entry) => {
          if (options.unmatched?.includes(entry.automationKey ?? '') === true) {
            return { outcome: 'unmatched', reason: 'no_match' } as never;
          }
          results += 1;
          return {
            outcome: 'recorded',
            caseUlid: ulidOf('01J9Z3K4M5N6P7Q8C', results),
            resultUlid: ulidOf('01J9Z3K4M5N6P7Q8R', results),
          };
        }),
        summary: { recorded: 0, created: 0, unmatched: 0 },
      };
      response.summary.recorded = response.results.filter(
        (entry) => entry.outcome === 'recorded',
      ).length;
      return json(201, response);
    }

    const stage = /^\/api\/v1\/runs\/(\w+)\/results\/(\w+)\/attachments:stage$/.exec(path);
    if (method === 'POST' && stage !== null) {
      const body = init.body as FormData;
      const parts = (body.getAll('file') as File[]).map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
      }));
      const resultUlid = stage[2] ?? '';
      stages.push({ resultUlid, body, parts });
      events.push(`stage ${resultUlid} ${parts.length}`);
      const failure = options.stageFailures?.[stages.length];
      if (failure !== undefined) return reply(failure);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await options.holdStages;
      inFlight -= 1;
      const attachments: StagedAttachment[] = parts.map((part) => {
        refs += 1;
        return {
          ulid: ulidOf('01J9Z3K4M5N6P7Q8A', refs),
          objectKey: `staging/org/${refs}`,
          mime: part.type,
          byteSize: part.size,
          originalFilename: part.name,
          disposition: 'attachment',
          thumbKey: null,
          width: null,
          height: null,
        };
      });
      return json(200, { attachments });
    }

    const commit = /^\/api\/v1\/runs\/(\w+)\/results\/(\w+)\/attachments$/.exec(path);
    if (method === 'PATCH' && commit !== null) {
      const body = JSON.parse(init.body as string) as CommitAttachmentsRequest;
      const resultUlid = commit[2] ?? '';
      commits.push({ resultUlid, body, key: headers.get('idempotency-key') });
      events.push(`commit ${resultUlid} ${body.attachments.length}`);
      const failure = options.commitFailures?.[commits.length];
      if (failure !== undefined) return reply(failure);
      return json(200, { attachments: body.attachments });
    }

    const close = /^\/api\/v1\/runs\/(\w+)\/close$/.exec(path);
    if (method === 'POST' && close !== null) {
      closes.push({ url, key: headers.get('idempotency-key') });
      events.push('close');
      if (options.close !== undefined) return reply(options.close);
      return json(200, { ulid: close[1], displayId: 'R-12', state: 'closed' });
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  return {
    fetch: fetchImpl,
    events,
    reports,
    stages,
    commits,
    closes,
    maxInFlight: () => maxInFlight,
  };
}

function setup(options: ReporterOptions & { server?: ServerOptions } = {}) {
  const { server: serverOptions, ...reporterOptions } = options;
  const server = fakeServer(serverOptions);
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  const reporter = createReporter({
    env: ENV,
    fetch: server.fetch,
    sleep: () => Promise.resolve(),
    random: () => 0,
    logger,
    ...reporterOptions,
  });
  return { reporter, server, lines };
}

function testResult(index: number, attachments?: Attachments): TestResultInput {
  return {
    identity: { file: 'e2e/cart.spec.ts', titlePath: ['Cart', `test ${index}`] },
    status: 'failed',
    ...(attachments === undefined ? {} : { attachments }),
  };
}

function text(content: string, name = 'log', contentType = 'text/plain') {
  return { name, contentType, body: content };
}

let dir = '';

async function file(name: string, content: string | number): Promise<string> {
  const path = join(dir, name);
  if (typeof content === 'number') {
    // A sparse file: its size without writing its bytes.
    await writeFile(path, '');
    await truncate(path, content);
  } else {
    await writeFile(path, content);
  }
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'probara-attachments-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('result attachments', () => {
  it('uploads the files of a recorded result as multipart parts, then commits them in order', async () => {
    const screenshot = await file('screenshot.png', 'PNG bytes');
    const { reporter, server } = setup();
    reporter.addResult(
      testResult(1, [
        { name: 'screenshot', contentType: 'image/png', path: screenshot },
        { name: 'trace', contentType: 'application/zip', body: new Uint8Array([80, 75, 3, 4]) },
        text('stdout line', 'stdout'),
        text('{}', ' my\nreport ', 'application/json'),
        text('x', 'notes.md', 'text/markdown'),
        text('y', 'dir/sub\\name', 'not a type'),
        { contentType: 'text/html', body: '<p>' },
      ]),
    );
    const summary = await reporter.complete();

    expect(server.stages).toHaveLength(1);
    expect(server.stages[0]?.resultUlid).toBe(ulidOf('01J9Z3K4M5N6P7Q8R', 1));
    expect(server.stages[0]?.parts).toEqual([
      { name: 'screenshot.png', type: 'image/png', size: 9 },
      { name: 'trace.zip', type: 'application/zip', size: 4 },
      { name: 'stdout.txt', type: 'text/plain', size: 11 },
      { name: 'my report.json', type: 'application/json', size: 2 },
      { name: 'notes.md', type: 'text/markdown', size: 1 },
      { name: 'dir_sub_name', type: 'application/octet-stream', size: 1 },
      { name: 'attachment.html', type: 'text/html', size: 3 },
    ]);
    const content = await (server.stages[0]?.body.getAll('file')[0] as File).text();
    expect(content).toBe('PNG bytes');

    expect(server.commits).toHaveLength(1);
    const [commit] = server.commits;
    expect(commit?.resultUlid).toBe(ulidOf('01J9Z3K4M5N6P7Q8R', 1));
    expect(commit?.body.attachments.map((item) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(commit?.body.attachments.map((item) => item.originalFilename)).toEqual(
      server.stages[0]?.parts.map((part) => part.name),
    );
    expect(commit?.body.attachments[0]).toEqual({
      ulid: ulidOf('01J9Z3K4M5N6P7Q8A', 1),
      objectKey: 'staging/org/1',
      mime: 'image/png',
      byteSize: 9,
      originalFilename: 'screenshot.png',
      disposition: 'attachment',
      thumbKey: null,
      width: null,
      height: null,
      position: 0,
    });
    expect(commit?.key).toMatch(/^[\x21-\x7E]{1,255}$/);

    expect(summary).toMatchObject({
      status: 'completed',
      attachments: { uploaded: 7, skipped: 0, failed: 0 },
      attachmentErrors: [],
    });
  });

  it('splits the stage requests of a result by total bytes, keeping the order', async () => {
    const big = await Promise.all([1, 2, 3].map((index) => file(`video-${index}.webm`, 30 * MIB)));
    const { reporter, server } = setup();
    reporter.addResult(
      testResult(1, [
        ...big.map((path) => ({ name: 'video', contentType: 'video/webm', path })),
        text('small', 'tail'),
      ]),
    );
    const summary = await reporter.complete();

    expect(server.stages.map((stage) => stage.parts.map((part) => part.name))).toEqual([
      ['video-1.webm', 'video-2.webm'],
      ['video-3.webm', 'tail.txt'],
    ]);
    for (const stage of server.stages) {
      expect(stage.parts.reduce((total, part) => total + part.size, 0)).toBeLessThanOrEqual(
        64 * MIB,
      );
    }
    expect(server.commits).toHaveLength(1);
    expect(server.commits[0]?.body.attachments.map((item) => item.originalFilename)).toEqual([
      'video-1.webm',
      'video-2.webm',
      'video-3.webm',
      'tail.txt',
    ]);
    expect(summary.attachments).toEqual({ uploaded: 4, skipped: 0, failed: 0 });
  });

  it('keeps the first 20 attachments of a result, in one stage request, and skips the rest with one warning', async () => {
    const { reporter, server, lines } = setup();
    reporter.addResult(
      testResult(
        1,
        Array.from({ length: 23 }, (_, index) => text(`${index}`, `file-${index}`)),
      ),
    );
    const summary = await reporter.complete();

    expect(server.stages.map((stage) => stage.parts.length)).toEqual([20]);
    expect(server.stages[0]?.parts.at(-1)?.name).toBe('file-19.txt');
    expect(summary.attachments).toEqual({ uploaded: 20, skipped: 3, failed: 0 });
    expect(lines.filter((line) => line.startsWith('warn: ') && line.includes('first 20'))).toEqual([
      expect.stringContaining('"Cart > test 1", 3 skipped') as string,
    ]);
  });

  it('skips missing, empty, oversized, denied and sourceless attachments with a warning', async () => {
    const good = await file('good.txt', 'ok');
    const empty = await file('empty.txt', '');
    const oversized = await file('huge.bin', 32 * MIB + 1);
    const folder = join(dir, 'folder');
    await mkdir(folder, { recursive: true });
    const { reporter, server, lines } = setup();
    reporter.addResult(
      testResult(1, [
        { name: 'missing', contentType: 'text/plain', path: join(dir, 'missing.txt') },
        { name: 'empty', contentType: 'text/plain', path: empty },
        { name: 'huge', contentType: 'application/octet-stream', path: oversized },
        { name: 'folder', contentType: 'text/plain', path: folder },
        { name: 'install', contentType: 'application/x-sh', body: 'echo hi' },
        text('', 'blank'),
        { name: 'nothing', contentType: 'text/plain' },
        { name: 'good', contentType: 'text/plain', path: good },
      ]),
    );
    const summary = await reporter.complete();

    expect(server.stages.map((stage) => stage.parts.map((part) => part.name))).toEqual([
      ['good.txt'],
    ]);
    expect(summary.attachments).toEqual({ uploaded: 1, skipped: 7, failed: 0 });
    const warnings = lines.filter((line) => line.startsWith('warn: Skipped an attachment'));
    for (const reason of [
      'missing or unreadable',
      'not a file',
      'empty',
      'larger than 32 MiB',
      'content type',
      'neither a path nor a body',
    ]) {
      expect(warnings.some((line) => line.includes(reason))).toBe(true);
    }
  });

  it('skips a file that reads as oversized from memory too', async () => {
    const { reporter, server } = setup();
    reporter.addResult(
      testResult(1, [
        {
          name: 'dump',
          contentType: 'application/octet-stream',
          body: new Uint8Array(32 * MIB + 1),
        },
        { name: 'max', contentType: 'application/octet-stream', body: new Uint8Array(32 * MIB) },
      ]),
    );
    const summary = await reporter.complete();

    expect(server.stages.map((stage) => stage.parts.map((part) => part.size))).toEqual([
      [32 * MIB],
    ]);
    expect(summary.attachments).toEqual({ uploaded: 1, skipped: 1, failed: 0 });
  });

  it('retries a failed stage request with a rebuilt body', async () => {
    const path = await file('retry.txt', 'again');
    const { reporter, server } = setup({
      server: {
        stageFailures: { 1: { status: 503, body: { error: { code: 'internal_error' } } } },
      },
    });
    reporter.addResult(testResult(1, [{ name: 'retry', contentType: 'text/plain', path }]));
    const summary = await reporter.complete();

    expect(server.stages).toHaveLength(2);
    expect(server.stages[1]?.body).not.toBe(server.stages[0]?.body);
    expect(server.stages[1]?.parts).toEqual(server.stages[0]?.parts);
    expect(await (server.stages[1]?.body.get('file') as File).text()).toBe('again');
    expect(summary.attachments).toEqual({ uploaded: 1, skipped: 0, failed: 0 });
  });

  it('counts the files of a refused stage request as failed, and the results stay recorded', async () => {
    const { reporter, server, lines } = setup({
      // One upload at a time, so the refused request is the one of the first result.
      attachmentConcurrency: 1,
      server: {
        stageFailures: {
          1: { status: 409, body: { error: { code: 'conflict', message: `run closed ${TOKEN}` } } },
        },
      },
    });
    reporter.addResult(testResult(1, [text('a'), text('b')]));
    reporter.addResult(testResult(2, [text('c')]));
    const summary = await reporter.complete();

    expect(server.commits.map((commit) => commit.resultUlid)).toEqual([
      ulidOf('01J9Z3K4M5N6P7Q8R', 2),
    ]);
    expect(summary).toMatchObject({
      status: 'completed',
      recorded: 2,
      errors: [],
      attachments: { uploaded: 1, skipped: 0, failed: 2 },
      attachmentErrors: [{ code: 'conflict', status: 409 }],
    });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    for (const line of lines) expect(line).not.toContain(TOKEN);
    expect(lines.some((line) => line.startsWith('warn: ') && line.includes('409'))).toBe(true);
  });

  it('counts the files of a failed commit as failed', async () => {
    const { reporter } = setup({
      server: {
        commitFailures: {
          1: { status: 413, body: { error: { code: 'storage_quota_exceeded', message: 'full' } } },
        },
      },
    });
    reporter.addResult(testResult(1, [text('a'), text('b')]));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({
      status: 'completed',
      attachments: { uploaded: 0, skipped: 0, failed: 2 },
      attachmentErrors: [{ code: 'storage_quota_exceeded', status: 413 }],
    });
  });

  it('defers the close until every upload settled, then closes the run on its own', async () => {
    const { reporter, server } = setup({ chunkSize: 2 });
    reporter.addResult(testResult(1, [text('a')]));
    reporter.addResult(testResult(2));
    reporter.addResult(testResult(3, [text('b'), text('c')]));
    const summary = await reporter.complete();

    expect(server.reports.map((report) => report.options?.close)).toEqual([false, false]);
    expect(server.events.at(-1)).toBe('close');
    expect(server.events.filter((event) => event === 'close')).toHaveLength(1);
    const lastCommit = server.events.findLastIndex((event) => event.startsWith('commit'));
    expect(lastCommit).toBe(server.events.length - 2);
    expect(server.closes[0]?.url).toBe(`${BASE_URL}/api/v1/runs/${CREATED_RUN}/close`);
    expect(server.closes[0]?.key).toMatch(/^[\x21-\x7E]{1,255}$/);
    expect(summary).toMatchObject({
      status: 'completed',
      run: { ulid: CREATED_RUN, state: 'closed' },
      attachments: { uploaded: 3, skipped: 0, failed: 0 },
    });
  });

  it('closes the run in the last report when no attachment was queued', async () => {
    const { reporter, server } = setup();
    reporter.addResult(testResult(1));
    reporter.addResult(testResult(2, []));
    const summary = await reporter.complete();

    expect(server.events).toEqual(['report close=true']);
    expect(summary).toMatchObject({
      run: { state: 'closed' },
      attachments: { uploaded: 0, skipped: 0, failed: 0 },
      attachmentErrors: [],
    });
  });

  it('uploads nothing, and closes in the last report, with uploadAttachments false or PROBARA_UPLOAD_ATTACHMENTS=false', async () => {
    for (const options of [
      { uploadAttachments: false },
      { env: { ...ENV, PROBARA_UPLOAD_ATTACHMENTS: 'false' } },
    ]) {
      const { reporter, server } = setup(options);
      reporter.addResult(testResult(1, [text('a')]));
      const summary = await reporter.complete();

      expect(server.events).toEqual(['report close=true']);
      expect(summary.attachments).toEqual({ uploaded: 0, skipped: 0, failed: 0 });
    }
  });

  it('never closes a run it must leave open, attachments or not', async () => {
    const { reporter, server } = setup({ env: { ...ENV, PROBARA_RUN_ULID: SHARED_RUN } });
    reporter.addResult(testResult(1, [text('a')]));
    const summary = await reporter.complete();

    expect(server.events).toEqual([
      'report close=false',
      `stage ${ulidOf('01J9Z3K4M5N6P7Q8R', 1)} 1`,
      `commit ${ulidOf('01J9Z3K4M5N6P7Q8R', 1)} 1`,
    ]);
    expect(summary.run?.state).toBe('open');
  });

  it('tolerates a run closed meanwhile, and reports a failed close without failing the results', async () => {
    const already = setup({
      server: { close: { status: 409, body: { error: { code: 'conflict', message: 'closed' } } } },
    });
    already.reporter.addResult(testResult(1, [text('a')]));
    expect(await already.reporter.complete()).toMatchObject({ status: 'completed', errors: [] });

    const broken = setup({
      maxRetries: 0,
      server: { close: { status: 403, body: { error: { code: 'forbidden', message: 'no' } } } },
    });
    broken.reporter.addResult(testResult(1, [text('a')]));
    const summary = await broken.reporter.complete();
    expect(summary).toMatchObject({
      status: 'completed',
      run: { state: 'open' },
      errors: [{ code: 'forbidden', status: 403 }],
      attachments: { uploaded: 1 },
    });
    expect(broken.lines.some((line) => line.startsWith('error: Could not close the run'))).toBe(
      true,
    );
  });

  it('uploads nothing for unmatched results or after a failed report, and never closes then', async () => {
    const unmatched = setup({
      server: {
        unmatched: [
          buildAutomationKey({ file: 'e2e/cart.spec.ts', titlePath: ['Cart', 'test 1'] }),
        ],
      },
    });
    unmatched.reporter.addResult(testResult(1, [text('a'), text('b')]));
    unmatched.reporter.addResult(testResult(2, [text('c')]));
    expect((await unmatched.reporter.complete()).attachments).toEqual({
      uploaded: 1,
      skipped: 2,
      failed: 0,
    });

    const failed = setup({
      chunkSize: 1,
      maxRetries: 0,
      server: {
        reportFailures: { 2: { status: 422, body: { error: { code: 'validation_failed' } } } },
      },
    });
    failed.reporter.addResult(testResult(1, [text('a')]));
    failed.reporter.addResult(testResult(2, [text('b')]));
    failed.reporter.addResult(testResult(3, [text('c')]));
    const summary = await failed.reporter.complete();
    expect(summary).toMatchObject({
      status: 'partial',
      attachments: { uploaded: 1, skipped: 2, failed: 0 },
    });
    expect(failed.server.closes).toHaveLength(0);
  });

  it('uploads at most attachmentConcurrency results at a time, without holding back the reports', async () => {
    for (const [attachmentConcurrency, expected] of [
      [undefined, 2],
      [1, 1],
      [3, 3],
    ] as const) {
      let release: () => void = () => undefined;
      const holdStages = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { reporter, server } = setup({
        chunkSize: 1,
        ...(attachmentConcurrency === undefined ? {} : { attachmentConcurrency }),
        server: { holdStages },
      });
      for (let index = 1; index <= 4; index += 1) {
        reporter.addResult(testResult(index, [text(`${index}`)]));
      }
      const completion = reporter.complete();
      // Every report goes out while the first uploads are still held.
      await expect.poll(() => server.reports.length).toBe(4);
      await expect.poll(() => server.stages.length).toBe(expected);
      release();
      const summary = await completion;

      expect(server.maxInFlight()).toBe(expected);
      expect(summary.attachments).toEqual({ uploaded: 4, skipped: 0, failed: 0 });
      expect(server.events.at(-1)).toBe('close');
    }
  });
});
