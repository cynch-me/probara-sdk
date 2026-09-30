/** The results file: what could not be sent (or everything, with reporting off), to send later. */
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReportRequest, ReportResponse } from './api.js';
import type { Logger } from './logger.js';
import { createReporter, type ReporterOptions } from './reporter.js';
import { readResultsFile } from './results-file.js';
import type { TestResultInput } from './result.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: BASE_URL };
const SHOP_RUN = '01J9Z3K4M5N6P7Q8R9S0T1V001';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'probara-results-file-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A fake Probara over `fetch`: reports (a created run is `SHOP_RUN` in SHOP, a run per other
 * project), and close. `failReports` answers the reports with these numbers (1-based, attempts
 * included) with a 503; `refuse` answers every report of these projects with a 403.
 */
function fakeServer(
  options: { failReports?: (number: number) => boolean; refuse?: string[] } = {},
) {
  let reports = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    await Promise.resolve();
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const report = /^\/api\/v1\/projects\/([^/]+)\/reports$/.exec(url.pathname);
    if (report === null) return json(200, { ulid: SHOP_RUN, displayId: 'R-1', state: 'closed' });
    reports += 1;
    const projectId = report[1] ?? '';
    if (options.refuse?.includes(projectId)) {
      return json(403, { error: { code: 'forbidden', message: 'No access' } });
    }
    if (options.failReports?.(reports) === true) {
      return json(503, { error: { code: 'internal_error', message: 'Down' } });
    }
    const body = JSON.parse(init.body as string) as ReportRequest;
    const response: ReportResponse = {
      run: {
        ulid: projectId === 'SHOP' ? SHOP_RUN : `01J9Z3K4M5N6P7Q8R9S0T1V${projectId}`,
        displayId: 'R-1',
        state: body.options?.close === true ? 'closed' : 'open',
      },
      results: body.results.map((_entry, index) => ({
        outcome: 'recorded',
        caseUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W4',
        resultUlid: `01J9Z3K4M5N6P7Q8R9S0T1V${String(reports * 100 + index).padStart(3, '0')}`,
      })),
      summary: { recorded: body.results.length, created: 0, unmatched: 0 },
    };
    return json(201, response);
  };
  return fetchImpl;
}

function capturingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  return { logger, lines };
}

function result(title: string, overrides: Partial<TestResultInput> = {}): TestResultInput {
  return {
    identity: { file: 'e2e/cart.spec.ts', titlePath: ['Cart', title] },
    status: 'passed',
    ...overrides,
  };
}

let files = 0;

/** A fresh results file path, and a reporter writing to it. */
function setup(options: ReporterOptions & { server?: Parameters<typeof fakeServer>[0] } = {}) {
  files += 1;
  const path =
    typeof options.resultsFile === 'string'
      ? options.resultsFile
      : join(dir, `run-${files}`, 'probara-results.json');
  const { server, ...rest } = options;
  const log = capturingLogger();
  const reporter = createReporter({
    env: ENV,
    fetch: fakeServer(server),
    sleep: () => Promise.resolve(),
    random: () => 0,
    maxRetries: 0,
    logger: log.logger,
    resultsFile: path,
    ...rest,
  });
  const read = async () => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  return { reporter, path, log, read };
}

describe('the results file of a reporter', () => {
  it('holds the results that could not be sent, as they were given, with the settings to send them again', async () => {
    const { reporter, path, log, read } = setup({
      server: { failReports: () => true },
      run: { name: 'Nightly', tags: ['smoke'] },
      statusMapping: { failed: 'blocked' },
    });
    const startedAt = new Date('2026-09-29T14:05:00.000Z');
    reporter.addResult(
      result('logs in', {
        startedAt,
        attachments: [{ name: 'log', contentType: 'text/plain', body: 'hello' }],
      }),
    );
    reporter.addResult(
      result('pays', {
        status: 'failed',
        error: { message: 'boom', stack: 'Error: boom' },
        attachments: [{ name: 'shot', contentType: 'image/png', path: 'shots/pay.png' }],
      }),
    );
    reporter.addResult(result('covers two cases', { caseDisplayIds: ['SHOP-1', 'SHOP-2'] }));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({
      status: 'failed',
      notSent: 4,
      resultsFile: { path, results: 4 },
    });
    const file = await read();
    expect(file).toEqual({
      version: 1,
      project: 'SHOP',
      run: { name: 'Nightly', tags: ['smoke'], close: { SHOP: true } },
      rootDir: process.cwd(),
      createMissingCases: true,
      statusMapping: { failed: 'blocked' },
      results: [
        {
          identity: { file: 'e2e/cart.spec.ts', titlePath: ['Cart', 'logs in'] },
          status: 'passed',
          startedAt: startedAt.toISOString(),
          attachments: [
            {
              fileName: 'log',
              contentType: 'text/plain',
              path: join(dir, `run-${files}`, 'probara-results-attachments', '1-log'),
            },
          ],
        },
        {
          identity: { file: 'e2e/cart.spec.ts', titlePath: ['Cart', 'pays'] },
          // The status as given: statusMapping applies again when the file is sent.
          status: 'failed',
          error: { message: 'boom', stack: 'Error: boom' },
          attachments: [{ name: 'shot', contentType: 'image/png', path: resolve('shots/pay.png') }],
        },
        expect.objectContaining({ caseDisplayId: 'SHOP-1' }),
        expect.objectContaining({ caseDisplayId: 'SHOP-2' }),
      ],
    });
    const body = join(dir, `run-${files}`, 'probara-results-attachments', '1-log');
    expect(await readFile(body, 'utf8')).toBe('hello');
    expect(JSON.stringify(file)).not.toContain(TOKEN);
    expect(log.lines).toContainEqual(
      `warn: Wrote the 4 results that were not sent to ${path}: send them with probara import results ${path}`,
    );
  });

  it('keeps the parameters, steps and case of a result, and the files of its steps', async () => {
    const { reporter, read } = setup({ server: { failReports: () => true } });
    reporter.addResult(
      result('pays', {
        parameters: { browser: 'chromium' },
        case: { tags: ['smoke'], steps: [{ action: 'Pay' }] },
        steps: [
          {
            action: 'Pay',
            status: 'passed',
            attachments: [{ name: 'receipt', contentType: 'text/plain', body: 'paid' }],
            steps: [
              {
                action: 'Confirm',
                status: 'passed',
                attachments: [{ name: 'shot', contentType: 'image/png', path: 'shots/ok.png' }],
              },
            ],
          },
        ],
      }),
    );
    await reporter.complete();

    const folder = join(dir, `run-${files}`, 'probara-results-attachments');
    const [written] = (await read()).results as TestResultInput[];
    expect(written).toMatchObject({
      parameters: { browser: 'chromium' },
      case: { tags: ['smoke'], steps: [{ action: 'Pay' }] },
      steps: [
        {
          action: 'Pay',
          status: 'passed',
          attachments: [
            { fileName: 'receipt', contentType: 'text/plain', path: join(folder, '1-receipt') },
          ],
          steps: [
            {
              action: 'Confirm',
              attachments: [
                { name: 'shot', contentType: 'image/png', path: resolve('shots/ok.png') },
              ],
            },
          ],
        },
      ],
    });
    expect(await readFile(join(folder, '1-receipt'), 'utf8')).toBe('paid');
  });

  it('keeps a copy of a temporary file next to it, the one of a step too, and points at it', async () => {
    const { reporter, read } = setup({ server: { failReports: () => true } });
    const temporary = await mkdtemp(join(tmpdir(), 'probara-adapter-copies-'));
    const [shot, trace] = [join(temporary, 'a1b2'), join(temporary, 'c3d4')];
    await writeFile(shot, 'png bytes');
    await writeFile(trace, 'trace');
    reporter.addResult(
      result('pays', {
        attachments: [
          { name: 'shot', fileName: 'shot.png', path: shot, temporary: true },
          { name: 'kept', path: 'shots/ok.png' },
        ],
        steps: [
          {
            action: 'Pay',
            status: 'passed',
            attachments: [{ name: 'trace', path: trace, temporary: true }],
          },
        ],
      }),
    );
    await reporter.complete();
    // The adapter removes its temporary files after the run.
    await rm(temporary, { recursive: true });

    const folder = join(dir, `run-${files}`, 'probara-results-attachments');
    const [written] = (await read()).results as TestResultInput[];
    expect(written?.attachments).toEqual([
      { name: 'shot', fileName: 'shot.png', path: join(folder, '1-shot.png') },
      { name: 'kept', path: resolve('shots/ok.png') },
    ]);
    expect(written?.steps?.[0]?.attachments).toEqual([
      { name: 'trace', path: join(folder, '2-trace') },
    ]);
    expect(await readFile(join(folder, '1-shot.png'), 'utf8')).toBe('png bytes');
    expect(await readFile(join(folder, '2-trace'), 'utf8')).toBe('trace');
  });

  it('points at a temporary file it cannot copy, as at any other file', async () => {
    const { reporter, read } = setup({ server: { failReports: () => true } });
    const gone = join(dir, 'gone.png');
    reporter.addResult(
      result('pays', { attachments: [{ name: 'shot', path: gone, temporary: true }] }),
    );
    await reporter.complete();

    const [written] = (await read()).results as TestResultInput[];
    expect(written?.attachments).toEqual([{ name: 'shot', path: gone }]);
  });

  it('keeps the links of a result', async () => {
    const { reporter, read } = setup({ server: { failReports: () => true } });
    const links = [{ url: 'https://jira.example.com/browse/PRB-7', name: 'PRB-7' }];
    reporter.addResult(result('pays', { links }));
    await reporter.complete();

    const [written] = (await read()).results as TestResultInput[];
    expect(written?.links).toEqual(links);
  });

  it('holds only the results of the failed report and after, and the run they belong to', async () => {
    const { reporter, read } = setup({
      server: { failReports: (number) => number >= 2 },
      chunkSize: 1,
    });
    for (const title of ['a', 'b', 'c']) reporter.addResult(result(title));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'partial', notSent: 2, resultsFile: { results: 2 } });
    const file = await read();
    expect(file).toMatchObject({ project: 'SHOP', run: { ulid: SHOP_RUN, close: { SHOP: true } } });
    expect(file.run).not.toHaveProperty('name');
    expect((file.results as TestResultInput[]).map((entry) => entry.identity.titlePath[1])).toEqual(
      ['b', 'c'],
    );
  });

  it('keeps the results of a project that refused, with the runs of the others', async () => {
    const { reporter, read } = setup({
      server: { refuse: ['WEB'] },
      projects: ['WEB'],
      run: { name: 'Nightly' },
    });
    reporter.addResult(result('shop'));
    reporter.addResult(result('web', { caseDisplayId: 'WEB-1' }));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'partial', resultsFile: { results: 1 } });
    expect(await read()).toMatchObject({
      project: 'SHOP',
      projects: ['WEB'],
      // WEB has no run yet: the name creates it.
      run: { ulid: SHOP_RUN, name: 'Nightly', close: { SHOP: true, WEB: true } },
      results: [expect.objectContaining({ caseDisplayId: 'WEB-1' })],
    });
  });

  it('writes nothing when every result was sent', async () => {
    const { reporter, path } = setup();
    reporter.addResult(result('a'));
    const summary = await reporter.complete();

    expect(summary.status).toBe('completed');
    expect(summary).not.toHaveProperty('resultsFile');
    await expect(readFile(path)).rejects.toThrow();
  });

  it('keeps a results file an earlier run left when every result of this run was sent', async () => {
    // Another shard, or an earlier run, could not send its results: they wait in the file.
    const earlier = setup({ server: { failReports: () => true } });
    earlier.reporter.addResult(result('from another shard'));
    await earlier.reporter.complete();
    const before = await readFile(earlier.path, 'utf8');

    const { reporter, log } = setup({ resultsFile: earlier.path });
    reporter.addResult(result('a'));
    const summary = await reporter.complete();

    expect(summary.status).toBe('completed');
    expect(summary).not.toHaveProperty('resultsFile');
    expect(await readFile(earlier.path, 'utf8')).toBe(before);
    expect(log.lines.filter((line) => line.includes(earlier.path))).toEqual([]);
  });

  it('writes to the first free sibling when a results file is already there, never touching it', async () => {
    // Another shard, or an earlier run, could not send its results: they wait in the file.
    const earlier = setup({ server: { failReports: () => true } });
    earlier.reporter.addResult(
      result('from another shard', { attachments: [{ name: 'log.txt', body: 'earlier' }] }),
    );
    await earlier.reporter.complete();
    const before = await readFile(earlier.path, 'utf8');
    const folder = dirname(earlier.path);

    const { reporter, log } = setup({
      resultsFile: earlier.path,
      server: { failReports: () => true },
      run: { name: 'Another run' },
    });
    reporter.addResult(result('b', { attachments: [{ name: 'log.txt', body: 'later' }] }));
    const summary = await reporter.complete();

    const sibling = join(folder, 'probara-results-2.json');
    expect(summary.resultsFile).toEqual({ path: sibling, results: 1 });
    expect(await readFile(earlier.path, 'utf8')).toBe(before);
    const written = JSON.parse(await readFile(sibling, 'utf8')) as {
      run: { name?: string };
      results: TestResultInput[];
    };
    // Only this run's results, under this run's settings: nothing of the earlier file.
    expect(written.run.name).toBe('Another run');
    expect(written.results.map((entry) => entry.identity.titlePath.at(-1))).toEqual(['b']);
    // The bodies go to the folder named after the file actually written.
    const [body] = written.results[0]?.attachments as { path: string }[];
    expect(body?.path).toBe(join(folder, 'probara-results-2-attachments', '1-log.txt'));
    expect(await readFile(body?.path ?? '', 'utf8')).toBe('later');
    expect(await readFile(join(folder, 'probara-results-attachments', '1-log.txt'), 'utf8')).toBe(
      'earlier',
    );
    expect(log.lines).toContainEqual(
      `warn: Wrote the 1 result that was not sent to ${sibling} (${earlier.path} already exists): send them with probara import results ${sibling}`,
    );
  });

  it('takes the next free number, skipping a name whose file or attachments folder exists', async () => {
    const offline = { env: { ...ENV, PROBARA_ENABLED: 'false' } };
    const first = setup(offline);
    first.reporter.addResult(result('first run'));
    await first.reporter.complete();
    const folder = dirname(first.path);
    await writeFile(join(folder, 'probara-results-2.json'), '{"mine":true}');
    // An attachments folder without its file: whatever is in it is not this run's.
    await mkdir(join(folder, 'probara-results-3-attachments'));

    const { reporter, log } = setup({ ...offline, resultsFile: first.path });
    reporter.addResult(result('second run'));
    const summary = await reporter.complete();

    const sibling = join(folder, 'probara-results-4.json');
    expect(summary.resultsFile).toEqual({ path: sibling, results: 1 });
    expect(await readFile(join(folder, 'probara-results-2.json'), 'utf8')).toBe('{"mine":true}');
    const written = JSON.parse(await readFile(sibling, 'utf8')) as { results: TestResultInput[] };
    expect(written.results.map((entry) => entry.identity.titlePath.at(-1))).toEqual(['second run']);
    expect(log.lines).toContainEqual(
      `info: Wrote 1 result to ${sibling} (${first.path} already exists): send them with probara import results ${sibling}`,
    );
  });

  it('never lets two reporters writing at once overwrite each other', async () => {
    files += 1;
    const path = join(dir, `run-${files}`, 'probara-results.json');
    const writers = ['a', 'b', 'c'].map((title) => {
      const writer = setup({ resultsFile: path, server: { failReports: () => true } });
      writer.reporter.addResult(result(title, { attachments: [{ name: 'log.txt', body: title }] }));
      return writer;
    });
    const summaries = await Promise.all(writers.map(({ reporter }) => reporter.complete()));

    const paths = summaries.map((summary) => summary.resultsFile?.path ?? '');
    expect(new Set(paths).size).toBe(3);
    const contents = await Promise.all(
      paths.map(async (written) => {
        const file = JSON.parse(await readFile(written, 'utf8')) as { results: TestResultInput[] };
        const [entry] = file.results;
        const [body] = (entry?.attachments ?? []) as { path: string }[];
        // Each file with the body of its own result, in the attachments folder of its own name.
        return `${entry?.identity.titlePath.at(-1) ?? ''}:${await readFile(body?.path ?? '', 'utf8')}`;
      }),
    );
    expect(contents.sort()).toEqual(['a:a', 'b:b', 'c:c']);
  });

  it('replaces the file in place with replaceResultsFile, for the adapter that sends that file', async () => {
    const earlier = setup({ server: { failReports: () => true } });
    earlier.reporter.addResult(result('a'));
    earlier.reporter.addResult(result('b'));
    await earlier.reporter.complete();

    const { reporter, read } = setup({
      resultsFile: earlier.path,
      replaceResultsFile: true,
      server: { failReports: () => true },
    });
    reporter.addResult(result('b'));
    const summary = await reporter.complete();

    expect(summary.resultsFile).toEqual({ path: earlier.path, results: 1 });
    const written = (await read()) as { results: TestResultInput[] };
    expect(written.results.map((entry) => entry.identity.titlePath.at(-1))).toEqual(['b']);
  });

  it('replaces the file atomically: a reader that has it open reads the whole earlier file, and no temporary file is left', async () => {
    const earlier = setup({ server: { failReports: () => true } });
    for (const title of ['a', 'b', 'c']) earlier.reporter.addResult(result(title));
    await earlier.reporter.complete();
    const before = await readFile(earlier.path, 'utf8');
    const reader = await open(earlier.path, 'r');
    try {
      const { reporter } = setup({
        resultsFile: earlier.path,
        replaceResultsFile: true,
        server: { failReports: () => true },
      });
      reporter.addResult(result('c'));
      await reporter.complete();

      expect(await reader.readFile('utf8')).toBe(before);
    } finally {
      await reader.close();
    }
    const after = JSON.parse(await readFile(earlier.path, 'utf8')) as { results: unknown[] };
    expect(after.results).toHaveLength(1);
    expect(await readdir(dirname(earlier.path))).toEqual(['probara-results.json']);
  });

  it('writes a new file atomically too, leaving no temporary file next to it', async () => {
    const { reporter, path } = setup({ server: { failReports: () => true } });
    reporter.addResult(result('a', { attachments: [{ name: 'log.txt', body: 'hello' }] }));
    await reporter.complete();

    expect((await readdir(dirname(path))).sort()).toEqual([
      'probara-results-attachments',
      'probara-results.json',
    ]);
  });

  it('leaves a file that is not a results file alone, writing next to it', async () => {
    const { reporter, path } = setup({ server: { failReports: () => true } });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"mine":true}');
    reporter.addResult(result('a'));
    const summary = await reporter.complete();

    expect(await readFile(path, 'utf8')).toBe('{"mine":true}');
    expect(summary.resultsFile?.path).toBe(join(dirname(path), 'probara-results-2.json'));
  });

  it('holds every result, as given, when reporting is off', async () => {
    const { reporter, path, read, log } = setup({
      env: { ...ENV, PROBARA_ENABLED: 'false' },
      run: { name: 'Nightly' },
    });
    expect(reporter.enabled).toBe(false);
    expect(reporter.acceptsResults).toBe(true);
    reporter.addResult(result('a', { status: 'skipped', caseDisplayIds: ['SHOP-1', 'SHOP-2'] }));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'disabled', resultsFile: { path, results: 1 } });
    expect(await read()).toMatchObject({
      version: 1,
      project: 'SHOP',
      run: { name: 'Nightly', close: { SHOP: true } },
      results: [{ status: 'skipped', caseDisplayIds: ['SHOP-1', 'SHOP-2'] }],
    });
    expect(log.lines).toContainEqual(
      `info: Wrote 1 result to ${path}: send them with probara import results ${path}`,
    );
  });

  it('holds every result without a project when reporting is not configured', async () => {
    const { reporter, read } = setup({ env: {} });
    reporter.addResult(result('a'));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'disabled', resultsFile: { results: 1 } });
    const file = await read();
    expect(file).not.toHaveProperty('project');
    expect(file.results).toHaveLength(1);
  });

  it('holds every result when the configuration cannot be used', async () => {
    const { reporter, read } = setup({ chunkSize: 0 });
    expect(reporter.acceptsResults).toBe(true);
    reporter.addResult(result('a'));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({ status: 'failed', resultsFile: { results: 1 } });
    expect(await read()).toMatchObject({ project: 'SHOP', results: [{ status: 'passed' }] });
  });

  it('accepts no result without a results file when reporting is off', () => {
    const reporter = createReporter({ env: { PROBARA_ENABLED: 'false' } });
    expect(reporter.acceptsResults).toBe(false);
    expect(createReporter({ env: ENV, fetch: fakeServer() }).acceptsResults).toBe(true);
  });

  it('still writes the results that were not sent when completing fails unexpectedly', async () => {
    const { reporter, path, read } = setup({ server: { failReports: () => true } });
    reporter.addResult(result('a'));
    // Stands for any unexpected failure once the reports settled.
    const all = vi.spyOn(Promise, 'all').mockRejectedValueOnce(new Error('unexpected'));
    try {
      const summary = await reporter.complete();

      expect(summary).toMatchObject({ status: 'failed', resultsFile: { path, results: 1 } });
      expect((await read()).results).toHaveLength(1);
    } finally {
      all.mockRestore();
    }
  });

  it('logs a file it cannot write and still completes, never throwing', async () => {
    const blocker = join(dir, 'a-file');
    await writeFile(blocker, 'not a folder');
    const path = join(blocker, 'probara-results.json');
    const { reporter, log } = setup({ server: { failReports: () => true }, resultsFile: path });
    reporter.addResult(result('a'));
    const summary = await reporter.complete();

    expect(summary).toMatchObject({
      status: 'failed',
      resultsFile: { path, results: 0, error: expect.any(String) as string },
    });
    expect(log.lines).toContainEqual(
      expect.stringMatching(new RegExp(`^error: Could not write the results file ${path}: `)),
    );
  });
});

describe('readResultsFile', () => {
  it('reads a results file back as the options and the results to send', async () => {
    const { reporter, path } = setup({
      server: { failReports: () => true },
      projects: ['WEB'],
      run: { name: 'Nightly', tags: ['smoke'], ulids: { WEB: '01J9Z3K4M5N6P7Q8R9S0T1V2W6' } },
      statusFilter: ['skipped'],
      suiteUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W5',
      source: { branch: 'main' },
      assignFailedTo: ['ana@example.com'],
    });
    reporter.addResult(result('a', { startedAt: new Date('2026-09-29T14:05:00.000Z') }));
    await reporter.complete();

    const read = await readResultsFile(path);
    expect(read).toEqual({
      ok: true,
      options: {
        projectId: 'SHOP',
        projects: ['WEB'],
        run: {
          name: 'Nightly',
          tags: ['smoke'],
          ulids: { WEB: '01J9Z3K4M5N6P7Q8R9S0T1V2W6' },
        },
        // The reporter created SHOP's run and reused WEB's: an import closes SHOP's only.
        closeRuns: { SHOP: true, WEB: false },
        source: { branch: 'main' },
        rootDir: process.cwd(),
        createMissingCases: true,
        suiteUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W5',
        statusFilter: ['skipped'],
        assignFailedTo: ['ana@example.com'],
      },
      results: [
        {
          identity: { file: 'e2e/cart.spec.ts', titlePath: ['Cart', 'a'] },
          status: 'passed',
          startedAt: '2026-09-29T14:05:00.000Z',
        },
      ],
    });
  });

  it('keeps the references by name every project takes when only other projects create runs', async () => {
    const { reporter, path, read } = setup({
      server: { failReports: () => true },
      projects: ['WEB'],
      run: {
        ulid: SHOP_RUN,
        name: 'Nightly run',
        description: 'Nightly',
        environment: 'staging',
        milestone: 'M-3',
        plan: 'Smoke',
        configurations: [{ group: 'OS', name: 'Linux' }],
      },
    });
    reporter.addResult(result('web', { caseDisplayId: 'WEB-1' }));
    await reporter.complete();

    // SHOP reuses its run; WEB's new run takes the description and the environment, which resolve
    // in WEB. The milestone, plan and configurations belong to SHOP's run, which keeps its own.
    const expected = {
      ulid: SHOP_RUN,
      name: 'Nightly run',
      description: 'Nightly',
      environment: 'staging',
    };
    const run = (await read()).run as Record<string, unknown>;
    expect(run).toMatchObject(expected);
    expect(Object.keys(run)).not.toContain('milestone');
    expect(Object.keys(run)).not.toContain('plan');
    expect(Object.keys(run)).not.toContain('configurations');
    expect(await readResultsFile(path)).toMatchObject({
      ok: true,
      options: { run: expected },
    });
  });

  it("keeps the milestone, plan and configurations of the project's new run", async () => {
    const references = {
      environment: 'staging',
      milestone: 'M-3',
      plan: 'Smoke',
      configurations: [{ group: 'OS', name: 'Linux' }],
    };
    const { reporter, read } = setup({
      server: { failReports: () => true },
      projects: ['WEB'],
      run: { name: 'Nightly run', ...references },
    });
    reporter.addResult(result('web', { caseDisplayId: 'WEB-1' }));
    await reporter.complete();

    expect((await read()).run).toMatchObject({ name: 'Nightly run', ...references });
  });

  it.each([
    ['not json', 'is not JSON'],
    // What a writer that stopped between claiming the name and filling it leaves.
    ['', 'is empty: a reporter may still be writing it, or stopped before it finished'],
    ['[]', 'is not a Probara results file'],
    // A version that is not a number is no version of the format.
    ['{"version":"1","results":[]}', 'is not a Probara results file'],
    [
      '{"version":2,"results":[]}',
      'holds version 2 of the results file: this version reads version 1',
    ],
    ['{"version":1}', 'is not a Probara results file: it has no results list'],
  ])('refuses %j', async (content, reason) => {
    const path = join(dir, `bad-${reason.length}.json`);
    await writeFile(path, content);
    expect(await readResultsFile(path)).toEqual({ ok: false, error: `${path} ${reason}` });
  });

  it('says a missing file cannot be read', async () => {
    const path = join(dir, 'missing.json');
    expect(await readResultsFile(path)).toEqual({
      ok: false,
      error: `${path} could not be read (ENOENT)`,
    });
  });
});
