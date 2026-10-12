/**
 * Unit tests of the reporter's hooks. Each reporter here gets an explicit environment, so no
 * `PROBARA_*` variable of the machine running the tests reaches it, and a `fetch` that records what it
 * is asked for and answers nothing: a unit test never reaches a socket.
 */
import { describe, expect, it } from 'vitest';
import ProbaraVitestReporter from './reporter.js';

const ROOT = '/work/shop';

/** The Vitest context and the lines the reporter writes to its logger. */
function harness() {
  const lines: string[] = [];
  const logger = {
    log: (message: string) => lines.push(message),
    warn: (message: string) => lines.push(message),
    error: (message: string) => lines.push(message),
  };
  return { lines, vitest: { config: { root: ROOT }, logger, projects: [] } as never };
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
    expect(() => {
      reporter.onTestRunStart();
    }).not.toThrow();
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
    reporter.onTestRunStart();
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
    expect(() => {
      reporter.onTestRunStart();
    }).not.toThrow();
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
    reporter.onTestRunStart();
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
    reporter.onTestRunStart();
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
});
