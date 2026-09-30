/** A reporter session across projects: each result goes into a run of its case's project. */
import { describe, expect, it } from 'vitest';
import type { ReportRequest, ReportResponse } from './api.js';
import type { Logger } from './logger.js';
import { createReporter, projectOfCase, type ReporterOptions } from './reporter.js';
import type { TestResultInput } from './result.js';

const TOKEN = 'probara_live_S3CRETtoken';
const BASE_URL = 'https://app.probara.test';
const ENV = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_BASE_URL: BASE_URL };
const WEB_RUN = '01J9Z3K4M5N6P7Q8R9S0T1VWEB';
const SHOP_RUN = '01J9Z3K4M5N6P7Q8R9S0T1VSHP';

interface Received {
  method: string;
  path: string;
  body: unknown;
}

interface ServerOptions {
  /** Answers every report of these projects with a 403. */
  refuse?: readonly string[];
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A fake Probara over `fetch`: runs per project (a created run is `R-<n>`), display ids of another
 * project unmatched as `invalid_display_id` like the server, run close, stage and commit.
 */
function fakeServer(options: ServerOptions = {}) {
  const requests: Received[] = [];
  const runs = new Map<
    string,
    { projectId: string; displayId: string; state: 'open' | 'closed' }
  >();
  let results = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : (init.body ?? undefined);
    requests.push({ method, path: url.pathname, body });
    await Promise.resolve();

    const report = /^\/api\/v1\/projects\/([^/]+)\/reports$/.exec(url.pathname);
    if (report !== null) {
      const projectId = report[1] ?? '';
      if (options.refuse?.includes(projectId)) {
        return json(403, { error: { code: 'forbidden', message: 'No access' } });
      }
      const request = body as ReportRequest;
      let ulid: string;
      if ('ulid' in request.run) ulid = request.run.ulid;
      else {
        ulid = `01J9Z3K4M5N6P7Q8R9S0T1V${String(runs.size + 1).padStart(3, '0')}`;
        runs.set(ulid, { projectId, displayId: `R-${runs.size + 1}`, state: 'open' });
      }
      const run = runs.get(ulid) ?? { projectId, displayId: 'R-99', state: 'open' as const };
      runs.set(ulid, run);
      if (request.options?.close === true) run.state = 'closed';
      const response: ReportResponse = {
        run: { ulid, displayId: run.displayId, state: run.state },
        results: request.results.map((entry) => {
          if (
            entry.caseDisplayId !== undefined &&
            !entry.caseDisplayId.startsWith(`${projectId}-`)
          ) {
            return { outcome: 'unmatched', reason: 'invalid_display_id' };
          }
          results += 1;
          return {
            outcome: 'recorded',
            caseUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W4',
            resultUlid: `01J9Z3K4M5N6P7Q8R9S0T1V${String(results).padStart(3, '0')}`,
          };
        }),
        summary: { recorded: 0, created: 0, unmatched: 0 },
      };
      response.summary.recorded = response.results.filter((r) => r.outcome === 'recorded').length;
      response.summary.unmatched = response.results.length - response.summary.recorded;
      return json(201, response);
    }
    const close = /^\/api\/v1\/runs\/([^/]+)\/close$/.exec(url.pathname);
    if (close !== null) {
      const ulid = close[1] ?? '';
      const run = runs.get(ulid) ?? { projectId: '?', displayId: 'R-0', state: 'open' as const };
      run.state = 'closed';
      runs.set(ulid, run);
      return json(200, { ulid, displayId: run.displayId, state: 'closed', name: 'run' });
    }
    if (/attachments:stage$/.test(url.pathname)) {
      return json(200, {
        attachments: [
          {
            ulid: '01J9Z3K4M5N6P7Q8R9S0T1V2W8',
            objectKey: 'staging/1',
            mime: 'text/plain',
            byteSize: 2,
            originalFilename: 'log.txt',
            disposition: 'attachment',
            thumbKey: null,
            width: null,
            height: null,
          },
        ],
      });
    }
    if (/attachments$/.test(url.pathname)) return json(200, { attachments: [] });
    return json(404, { error: { code: 'not_found', message: 'Not found' } });
  };
  return {
    fetch: fetchImpl,
    requests,
    reports: () =>
      requests
        .filter((request) => request.path.endsWith('/reports'))
        .map((request) => ({
          projectId: request.path.split('/')[4],
          body: request.body as ReportRequest,
        })),
    paths: (pattern: RegExp) => requests.map((r) => r.path).filter((path) => pattern.test(path)),
  };
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
    identity: { file: 'e2e/cart.spec.ts', titlePath: [title] },
    status: 'passed',
    ...overrides,
  };
}

function setup(options: ReporterOptions & { server?: ServerOptions } = {}) {
  const { server: serverOptions, ...reporterOptions } = options;
  const server = fakeServer(serverOptions);
  const log = capturingLogger();
  const reporter = createReporter({
    env: ENV,
    fetch: server.fetch,
    sleep: () => Promise.resolve(),
    random: () => 0,
    logger: log.logger,
    ...reporterOptions,
  });
  return { reporter, server, log };
}

/** The case of each entry of each report, by project. */
function casesByProject(reports: ReturnType<ReturnType<typeof fakeServer>['reports']>) {
  return reports.map(({ projectId, body }) => [
    projectId,
    body.results.map((entry) => entry.caseDisplayId ?? entry.automationKey),
  ]);
}

describe('createReporter across projects', () => {
  it('sends each result to the project of its case, in a run of its own, and the rest to the project', async () => {
    const { reporter, server } = setup({
      projects: ['WEB', 'API'],
      run: { name: 'Nightly', tags: ['smoke'] },
      suiteUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W5',
    });
    reporter.addResult(result('creates a case'));
    reporter.addResult(result('web', { caseDisplayId: 'WEB-3' }));
    reporter.addResult(result('everywhere', { caseDisplayIds: ['SHOP-1', 'WEB-2', 'API-5'] }));
    const summary = await reporter.complete();

    expect(casesByProject(server.reports())).toEqual([
      ['SHOP', ['e2e/cart.spec.ts > creates a case', 'SHOP-1']],
      ['WEB', ['WEB-3', 'WEB-2']],
      ['API', ['API-5']],
    ]);
    const [shop, web, api] = server.reports().map((report) => report.body);
    expect(shop).toMatchObject({
      run: { name: 'Nightly', tags: ['smoke'] },
      options: { createMissingCases: true, suiteUlid: '01J9Z3K4M5N6P7Q8R9S0T1V2W5', close: true },
    });
    // Only the configured project creates cases; its suite belongs to it alone.
    for (const other of [web, api]) {
      expect(other).toMatchObject({
        run: { name: 'Nightly', tags: ['smoke'] },
        options: { createMissingCases: false, close: true },
      });
      expect(other?.options).not.toHaveProperty('suiteUlid');
    }
    expect(summary).toMatchObject({
      status: 'completed',
      recorded: 5,
      dropped: 0,
      run: { displayId: 'R-1', url: `${BASE_URL}/projects/SHOP/runs/R-1`, state: 'closed' },
    });
    expect(summary.projects).toEqual([
      {
        projectId: 'SHOP',
        status: 'completed',
        run: expect.objectContaining({ displayId: 'R-1', state: 'closed' }) as unknown,
        recorded: 2,
        created: 0,
        unmatched: 0,
        notSent: 0,
        errors: [],
        attachments: { uploaded: 0, skipped: 0, failed: 0 },
      },
      expect.objectContaining({
        projectId: 'WEB',
        status: 'completed',
        run: expect.objectContaining({ url: `${BASE_URL}/projects/WEB/runs/R-2` }) as unknown,
        recorded: 2,
      }),
      expect.objectContaining({
        projectId: 'API',
        run: expect.objectContaining({ url: `${BASE_URL}/projects/API/runs/R-3` }) as unknown,
        recorded: 1,
      }),
    ]);
  });

  it('logs the run of each project with its project', async () => {
    const { reporter, log } = setup({ projects: ['WEB'] });
    reporter.addResult(result('a'));
    reporter.addResult(result('b', { caseDisplayId: 'WEB-1' }));
    await reporter.complete();

    expect(log.lines.filter((line) => line.startsWith('info: '))).toEqual([
      `info: Recorded 1 result (0 new cases, 0 unmatched) in R-1 of SHOP (closed): ${BASE_URL}/projects/SHOP/runs/R-1`,
      `info: Recorded 1 result (0 new cases, 0 unmatched) in R-2 of WEB (closed): ${BASE_URL}/projects/WEB/runs/R-2`,
    ]);
  });

  it('never sends a case of a project that is not listed, with one warning per project', async () => {
    const { reporter, server, log } = setup();
    reporter.addResult(result('web', { caseDisplayId: 'WEB-1' }));
    reporter.addResult(result('web again', { caseDisplayId: 'WEB-2' }));
    reporter.addResult(result('api', { caseDisplayId: 'API-1' }));
    reporter.addResult(result('both', { caseDisplayIds: ['SHOP-1', 'WEB-3'] }));
    const summary = await reporter.complete();

    expect(casesByProject(server.reports())).toEqual([['SHOP', ['SHOP-1']]]);
    expect(summary).toMatchObject({ status: 'completed', recorded: 1, dropped: 4 });
    const dropped = log.lines.filter((line) => line.includes('neither the project'));
    expect(dropped).toEqual([
      'warn: Did not send the results linked to cases of WEB: WEB is neither the project (SHOP) nor one of projects (PROBARA_PROJECTS) (first seen in "web"; repeats are logged at debug)',
      'debug: Did not send the results linked to cases of WEB: WEB is neither the project (SHOP) nor one of projects (PROBARA_PROJECTS) ("web again")',
      'warn: Did not send the results linked to cases of API: API is neither the project (SHOP) nor one of projects (PROBARA_PROJECTS) (first seen in "api"; repeats are logged at debug)',
      'debug: Did not send the results linked to cases of WEB: WEB is neither the project (SHOP) nor one of projects (PROBARA_PROJECTS) ("both")',
    ]);
  });

  it('leaves a malformed case id to the configured project, whose server refuses it', async () => {
    const { reporter, server } = setup({ projects: ['WEB'] });
    reporter.addResult(result('lower', { caseDisplayId: 'web-1' }));
    const summary = await reporter.complete();

    expect(casesByProject(server.reports())).toEqual([['SHOP', ['web-1']]]);
    expect(summary.unmatched).toEqual([
      expect.objectContaining({ reason: 'invalid_display_id', caseDisplayId: 'web-1' }),
    ]);
  });

  it('reuses the run of run.ulids in each project and leaves reused runs open', async () => {
    const { reporter, server } = setup({
      projects: ['WEB', 'API'],
      run: { ulids: { WEB: WEB_RUN, SHOP: SHOP_RUN } },
    });
    reporter.addResult(result('shop', { caseDisplayId: 'SHOP-1' }));
    reporter.addResult(result('web', { caseDisplayId: 'WEB-1' }));
    reporter.addResult(result('api', { caseDisplayId: 'API-1' }));
    const summary = await reporter.complete();

    const runs = server.reports().map(({ projectId, body }) => [projectId, body.run, body.options]);
    expect(runs).toEqual([
      ['SHOP', { ulid: SHOP_RUN }, expect.objectContaining({ close: false })],
      ['WEB', { ulid: WEB_RUN }, expect.objectContaining({ close: false })],
      [
        'API',
        expect.objectContaining({ name: expect.any(String) as string }),
        expect.objectContaining({ close: true }),
      ],
    ]);
    expect(summary.projects.map((project) => project.run?.state)).toEqual([
      'open',
      'open',
      'closed',
    ]);
  });

  it('keeps reporting to the other projects when one refuses, and says which one failed', async () => {
    const { reporter, server, log } = setup({ projects: ['WEB'], server: { refuse: ['WEB'] } });
    reporter.addResult(result('shop'));
    reporter.addResult(result('web', { caseDisplayId: 'WEB-1' }));
    const summary = await reporter.complete();

    expect(server.reports().map((report) => report.projectId)).toEqual(['SHOP', 'WEB']);
    expect(summary).toMatchObject({
      status: 'partial',
      recorded: 1,
      notSent: 1,
      errors: [{ message: expect.stringMatching(/^WEB: /) as string, status: 403 }],
    });
    expect(summary.projects.map(({ projectId, status }) => [projectId, status])).toEqual([
      ['SHOP', 'completed'],
      ['WEB', 'failed'],
    ]);
    expect(log.lines).toContainEqual(
      expect.stringMatching(
        /^error: 1 result was not sent to WEB: .*No run was created or updated/,
      ),
    );
  });

  it('fails when every project fails', async () => {
    const { reporter } = setup({ projects: ['WEB'], server: { refuse: ['SHOP', 'WEB'] } });
    reporter.addResult(result('shop'));
    reporter.addResult(result('web', { caseDisplayId: 'WEB-1' }));
    expect(await reporter.complete()).toMatchObject({ status: 'failed', notSent: 2 });
  });

  it('uploads the files of a result to its result in the run of its project', async () => {
    const { reporter, server } = setup({ projects: ['WEB'], run: { ulids: { WEB: WEB_RUN } } });
    reporter.addResult(
      result('web', {
        caseDisplayId: 'WEB-1',
        attachments: [{ name: 'log.txt', contentType: 'text/plain', body: 'ok' }],
      }),
    );
    const summary = await reporter.complete();

    expect(server.paths(/attachments/)).toEqual([
      expect.stringMatching(
        new RegExp(`^/api/v1/runs/${WEB_RUN}/results/[^/]+/attachments:stage$`),
      ),
      expect.stringMatching(new RegExp(`^/api/v1/runs/${WEB_RUN}/results/[^/]+/attachments$`)),
    ]);
    expect(summary.projects[0]).toMatchObject({
      projectId: 'WEB',
      attachments: { uploaded: 1, skipped: 0, failed: 0 },
    });
    expect(summary.attachments).toEqual({ uploaded: 1, skipped: 0, failed: 0 });
  });

  it("creates every project's run with the environment, and only the project's with its milestone, plan and configurations", async () => {
    const { reporter, server, log } = setup({
      projects: ['WEB'],
      run: {
        name: 'Nightly',
        description: 'Nightly regression',
        environment: 'staging',
        milestone: 'Sprint 12',
        plan: 'Smoke',
        configurations: [{ group: 'OS', name: 'Linux' }],
      },
    });
    reporter.addResult(result('shop', { caseDisplayId: 'SHOP-1' }));
    reporter.addResult(result('web', { caseDisplayId: 'WEB-3' }));
    await reporter.complete();

    const runs = Object.fromEntries(
      server.reports().map(({ projectId, body }) => [projectId ?? '', body.run] as const),
    );
    expect(runs).toEqual({
      SHOP: {
        name: 'Nightly',
        description: 'Nightly regression',
        environment: 'staging',
        milestone: 'Sprint 12',
        plan: 'Smoke',
        configurations: [{ group: 'OS', name: 'Linux' }],
      },
      WEB: { name: 'Nightly', description: 'Nightly regression', environment: 'staging' },
    });
    expect(log.lines).toContain(
      'warn: Sent milestone, plan and configurations with the run of SHOP only: they belong to one project. Create the runs of WEB with their own (probara run create --project <code>) and pass them in run.ulids',
    );
  });

  it('closes a created run of another project after the uploads of its results', async () => {
    const { reporter, server } = setup({ projects: ['WEB'] });
    reporter.addResult(
      result('web', {
        caseDisplayId: 'WEB-1',
        attachments: [{ name: 'log.txt', contentType: 'text/plain', body: 'ok' }],
      }),
    );
    const summary = await reporter.complete();

    expect(server.reports()[0]?.body.options).toMatchObject({ close: false });
    expect(server.paths(/close$/)).toHaveLength(1);
    expect(summary.projects[0]?.run?.state).toBe('closed');
  });
});

describe('projectOfCase', () => {
  const config = {
    projectId: 'SHOP',
    projects: [{ projectId: 'WEB', run: { ulid: WEB_RUN }, closeRun: false }],
  };

  it('is the project of the case, when it is the project or one of projects', () => {
    expect(projectOfCase('WEB-3', config)).toBe('WEB');
    expect(projectOfCase('SHOP-1', config)).toBe('SHOP');
  });

  it('is the configured project without a case, or with a malformed id', () => {
    expect(projectOfCase(undefined, config)).toBe('SHOP');
    expect(projectOfCase('web-3', config)).toBe('SHOP');
  });

  it('is undefined for a case of a project that is not listed: the result is dropped', () => {
    expect(projectOfCase('API-2', config)).toBeUndefined();
    expect(projectOfCase('WEB-1', { projectId: 'SHOP', projects: [] })).toBeUndefined();
  });
});
