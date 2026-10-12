/**
 * Unit tests of the reporter's hooks. Each reporter here gets an explicit environment, so no
 * `PROBARA_*` variable of the machine running the tests reaches it, and a `fetch` that records what it
 * is asked for and answers nothing: a unit test never reaches a socket.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ProbaraVitestReporter from './reporter.js';

const ROOT = '/work/shop';
/** The key of the watch session on `globalThis` (`watch-runs.ts`). */
const WATCH_SESSION = Symbol.for('@probara/vitest-reporter/watch-runs/v1');

/** The Vitest context and the lines the reporter writes to its logger; `config` adds to the Vitest config. */
function harness(config: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const logger = {
    log: (message: string) => lines.push(message),
    warn: (message: string) => lines.push(message),
    error: (message: string) => lines.push(message),
  };
  return { lines, vitest: { config: { root: ROOT, ...config }, logger, projects: [] } as never };
}

/** A `fetch` that records every request it is given, and answers none of them. */
function silentFetch() {
  const requests: unknown[] = [];
  const fetch = (input: string | URL | Request): Promise<Response> => {
    requests.push(input);
    return Promise.reject(new Error('unit tests send no request'));
  };
  return { requests, fetch };
}

/** One file of a project with one test that Vitest retried, and whose attempts were not recorded. */
function retriedModule(project: string, file: string) {
  const test = {
    parent: { type: 'module' },
    module: { moduleId: `${ROOT}/tests/${file}` },
    name: 'retries',
    options: { mode: 'run' },
    meta: () => ({}),
    result: () => ({ state: 'passed', errors: [] }),
    diagnostic: () => ({ duration: 1, startTime: 1, retryCount: 1, repeatCount: 0 }),
    annotations: () => [],
  };
  return {
    moduleId: test.module.moduleId,
    project: { name: project },
    state: () => 'passed',
    errors: () => [],
    children: { allTests: () => [test][Symbol.iterator](), allSuites: () => [][Symbol.iterator]() },
  };
}

describe('ProbaraVitestReporter', () => {
  it('never throws out of a hook when its options throw while it starts: the run goes on, and the error is logged', async () => {
    const { lines, vitest } = harness();
    const options = {
      env: {},
      get projectId(): string {
        throw new Error('planted: the options broke');
      },
    };
    const reporter = new ProbaraVitestReporter(options);
    expect(() => {
      reporter.onInit(vitest);
    }).not.toThrow();
    await expect(reporter.onTestRunStart()).resolves.toBeUndefined();
    await expect(reporter.onTestRunEnd([], [])).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('planted: the options broke');
  });

  it('never throws out of the end of a run whose modules throw while they are read, and logs what broke', async () => {
    const { lines, vitest } = harness();
    const silent = silentFetch();
    const reporter = new ProbaraVitestReporter({
      projectId: 'SHOP',
      apiToken: 'prb_test_TOKEN',
      baseUrl: 'http://probara.invalid',
      env: {},
      fetch: silent.fetch,
    });
    reporter.onInit(vitest);
    await reporter.onTestRunStart();
    const broken = {
      moduleId: `${ROOT}/tests/broken.test.ts`,
      state: () => 'passed',
      errors: () => [],
      get children(): never {
        throw new Error('planted: the tree broke');
      },
    };
    await expect(reporter.onTestRunEnd([broken as never], [])).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('planted: the tree broke');
    expect(silent.requests).toEqual([]);
  });

  it('reports an options value that is not an object as core does, and never throws', async () => {
    const { lines, vitest } = harness();
    const reporter = new ProbaraVitestReporter(null as never);
    expect(() => {
      reporter.onInit(vitest);
    }).not.toThrow();
    await expect(reporter.onTestRunStart()).resolves.toBeUndefined();
    await expect(reporter.onTestRunEnd([], [])).resolves.toBeUndefined();
    expect(lines.join('\n')).toContain('options must be an object');
  });

  it('warns about the retries that were not recorded in a project whose attempts are recorded, even when another project could not record its own', async () => {
    const { lines } = harness();
    // The results of the two retried tests are sent at the end: a refusal that core does not retry
    // ends the send at once, where a rejected request would be retried with a wait.
    const requests: unknown[] = [];
    const refusing = (input: string | URL | Request): Promise<Response> => {
      requests.push(input);
      return Promise.resolve(new Response('{"error":"planted: refused"}', { status: 400 }));
    };
    // A project whose config refuses the setup file: its attempts are not recorded.
    const legacy = {
      name: 'legacy',
      config: {
        setupFiles: Object.freeze([] as string[]) as string[],
        browser: { enabled: false },
      },
      provide: () => undefined,
    };
    const api = {
      name: 'api',
      config: { setupFiles: [] as string[], browser: { enabled: false } },
      provide: () => undefined,
    };
    const logger = {
      log: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    };
    const reporter = new ProbaraVitestReporter({
      projectId: 'SHOP',
      apiToken: 'prb_test_TOKEN',
      baseUrl: 'http://probara.invalid',
      env: {},
      fetch: refusing,
    });
    reporter.onInit({ config: { root: ROOT }, logger, projects: [legacy, api] } as never);
    await reporter.onTestRunStart();
    await reporter.onTestRunEnd(
      [retriedModule('legacy', 'legacy.test.ts'), retriedModule('api', 'api.test.ts')] as never,
      [],
    );
    const text = lines.join('\n');
    expect(text).toContain('could not add the setup file to project "legacy"');
    expect(text).toContain(
      'Vitest retried or repeated 1 test whose earlier attempts were not recorded',
    );
    expect(requests.length).toBeGreaterThan(0);
  });

  it('warns once about the files Vitest never ran, and about unhandled errors, and sends nothing for either', async () => {
    const { lines, vitest } = harness();
    const silent = silentFetch();
    const reporter = new ProbaraVitestReporter({
      projectId: 'SHOP',
      apiToken: 'prb_test_TOKEN',
      baseUrl: 'http://probara.invalid',
      env: {},
      fetch: silent.fetch,
    });
    reporter.onInit(vitest);
    await reporter.onTestRunStart();
    const neverStarted = {
      moduleId: `${ROOT}/tests/queued.test.ts`,
      project: { name: 'shop' },
      state: () => 'queued',
      errors: () => [],
      children: { allTests: () => [][Symbol.iterator](), allSuites: () => [][Symbol.iterator]() },
    };
    await reporter.onTestRunEnd([neverStarted as never], [new Error('boom'), new Error('bang')]);
    const text = lines.join('\n');
    expect(text).toContain('Vitest did not run 1 test file of this run');
    expect(text).toContain('Vitest reported 2 unhandled errors outside the tests');
    expect(silent.requests).toEqual([]);
  });

  it('removes the attachment copies of a watch run whose refused re-run cannot start, and never fails the run', async () => {
    // The session refused the run of SHOP, and its re-run cannot start: the session's options throw from its second call.
    const holder = globalThis as unknown as Record<symbol, unknown>;
    const previous = holder[WATCH_SESSION];
    const refused = {
      projectId: 'SHOP',
      run: { ulid: '01J9Z3K4M5N6P7Q8R9S0T1V2W3', displayId: 'SHOP-R1' },
      gone: 'closed',
      partial: false,
    };
    let starts = 0;
    holder[WATCH_SESSION] = {
      options: (core: unknown) => {
        starts += 1;
        if (starts > 1) throw new Error('planted: the re-send cannot start');
        return core;
      },
      follow: () => ({ started: [], refused: [refused] }),
      adopt: () => [],
    };
    const attachmentsDir = await mkdtemp(join(tmpdir(), 'probara-copies-'));
    try {
      // Only Vitest's own reporters: a run with them removes its copies (V-D88).
      const { lines, vitest } = harness({ attachmentsDir, watch: true, reporters: ['default'] });
      const reporter = new ProbaraVitestReporter({
        projectId: 'SHOP',
        apiToken: 'prb_test_TOKEN',
        baseUrl: 'http://probara.invalid',
        env: {},
        fetch: silentFetch().fetch,
      });
      reporter.onInit(vitest);
      await reporter.onTestRunStart();
      // The copies of this run: the folder the reporter gave its workers, which holds a copied file.
      const filesDir = Reflect.get(reporter, 'filesDir') as string;
      await mkdir(filesDir, { recursive: true });
      await writeFile(join(filesDir, 'receipt.txt'), 'copied');
      await expect(reporter.onTestRunEnd([], [])).resolves.toBeUndefined();
      expect(existsSync(filesDir)).toBe(false);
      expect(lines.join('\n')).toContain('planted: the re-send cannot start');
    } finally {
      holder[WATCH_SESSION] = previous;
      await rm(attachmentsDir, { recursive: true, force: true });
    }
  });

  it('runs and reports every test of a project whose provide refuses the run selection, and says so', async () => {
    const { lines } = harness();
    // The run has one case, SHOP-1, that the first test names: the second test is outside the run.
    const page = { items: [{ caseDisplayId: 'SHOP-1', automationKey: null }], nextCursor: null };
    const fetch = (input: string | URL | Request): Promise<Response> => {
      if (urlOf(input).includes('/case-keys')) {
        return Promise.resolve(new Response(JSON.stringify(page), { status: 200 }));
      }
      return Promise.resolve(new Response('{"error":"planted: refused"}', { status: 400 }));
    };
    // A project whose provide refuses the selection: its workers keep no selection, so every test runs.
    const unit = {
      name: 'unit',
      config: { setupFiles: [] as string[], browser: { enabled: false } },
      provide: (key: string) => {
        if (key === 'probaraRunSelection') throw new Error('planted: the value is refused');
      },
    };
    const logger = {
      log: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    };
    const reporter = new ProbaraVitestReporter({
      projectId: 'SHOP',
      apiToken: 'prb_test_TOKEN',
      baseUrl: 'http://probara.invalid',
      env: {},
      fetch,
      runCasesOnly: true,
      run: { ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    });
    reporter.onInit({ config: { root: ROOT }, logger, projects: [unit] } as never);
    await reporter.onTestRunStart();
    await reporter.onTestRunEnd(
      [planModule('unit', 'checkout.test.ts', ['SHOP-1 pays', 'refunds'])] as never,
      [],
    );
    const text = lines.join('\n');
    expect(text).toContain('could not give project "unit" the cases of the run');
    expect(text).toContain('Sending 2 results of 2 tests');
    expect(text).not.toContain('Ran only the tests of run');
  });

  it('reports every test of a watch re-run whose cases cannot be read: the selection of the run before is not kept', async () => {
    const { lines } = harness();
    const page = { items: [{ caseDisplayId: 'SHOP-1', automationKey: null }], nextCursor: null };
    let reads = 0;
    const fetch = (input: string | URL | Request): Promise<Response> => {
      if (urlOf(input).includes('/case-keys')) {
        reads += 1;
        // The first run lists its cases; the re-run's read is refused, so the re-run has no selection.
        return Promise.resolve(
          reads === 1
            ? new Response(JSON.stringify(page), { status: 200 })
            : new Response('{"error":"planted: refused"}', { status: 400 }),
        );
      }
      return Promise.resolve(new Response('{"error":"planted: refused"}', { status: 400 }));
    };
    const unit = {
      name: 'unit',
      config: { setupFiles: [] as string[], browser: { enabled: false } },
      provide: () => undefined,
    };
    const logger = {
      log: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    };
    const reporter = new ProbaraVitestReporter({
      projectId: 'SHOP',
      apiToken: 'prb_test_TOKEN',
      baseUrl: 'http://probara.invalid',
      env: {},
      fetch,
      runCasesOnly: true,
      run: { ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    });
    reporter.onInit({ config: { root: ROOT }, logger, projects: [unit] } as never);
    await reporter.onTestRunStart();
    await reporter.onTestRunStart();
    await reporter.onTestRunEnd(
      [planModule('unit', 'checkout.test.ts', ['SHOP-1 pays', 'refunds'])] as never,
      [],
    );
    expect(reads).toBe(2);
    expect(lines.join('\n')).toContain('Sending 2 results of 2 tests');
  });
});

/** The URL a fetch input names: a `Request` carries its own. */
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** One file of a project with the tests `titles` (each passed, run once), for the reporter's run-end walk. */
function planModule(project: string, file: string, titles: string[]) {
  const moduleId = `${ROOT}/tests/${file}`;
  const tests = titles.map((name) => ({
    name,
    parent: { type: 'module' },
    module: { moduleId },
    options: { mode: 'run' },
    meta: () => ({}),
    result: () => ({ state: 'passed', errors: [] }),
    diagnostic: () => ({ duration: 1, startTime: 1, retryCount: 0, repeatCount: 0 }),
    annotations: () => [],
  }));
  return {
    moduleId,
    project: { name: project },
    state: () => 'passed',
    errors: () => [],
    children: {
      allTests: () => tests[Symbol.iterator](),
      allSuites: () => [][Symbol.iterator](),
    },
  };
}

describe('a browser project whose Vitest internals cannot be read (a future Vitest change)', () => {
  it('keeps the run: the start hook resolves, and one warning names the project', async () => {
    const lines: string[] = [];
    const logger = {
      log: (message: string) => lines.push(message),
      warn: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    };
    const browser = {
      name: 'browser',
      config: { root: ROOT, browser: { enabled: true }, setupFiles: [] as string[] },
      provide: () => undefined,
      get _parentBrowser(): never {
        throw new Error('the parent browser moved');
      },
    };
    const vitest = { config: { root: ROOT }, logger, projects: [browser] } as never;
    const reporter = new ProbaraVitestReporter({ env: {}, fetch: silentFetch().fetch });
    reporter.onInit(vitest);

    await expect(reporter.onTestRunStart()).resolves.toBeUndefined();
    const warnings = lines.filter((line) => line.includes('browser commands'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'could not give the browser commands to project "browser": the parent browser moved',
    );
  });
});
