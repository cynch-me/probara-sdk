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
  return { lines, vitest: { config: { root: ROOT }, logger } as never };
}

describe('ProbaraVitestReporter', () => {
  it('never throws out of a hook when its options throw while it starts: the run goes on, and the error is logged', async () => {
    const { lines, vitest } = harness();
    const options = {
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
    const reporter = new ProbaraVitestReporter({
      projectId: 'SHOP',
      apiToken: 'prb_test_TOKEN',
      baseUrl: 'http://127.0.0.1:9',
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

  it('warns once about the files Vitest never ran, and about unhandled errors, and sends nothing for either', async () => {
    const { lines, vitest } = harness();
    const reporter = new ProbaraVitestReporter({
      projectId: 'SHOP',
      apiToken: 'prb_test_TOKEN',
      baseUrl: 'http://127.0.0.1:9',
    });
    reporter.onInit(vitest);
    reporter.onTestRunStart();
    const neverStarted = {
      moduleId: `${ROOT}/tests/queued.test.ts`,
      state: () => 'queued',
      errors: () => [],
      children: { allTests: () => [][Symbol.iterator](), allSuites: () => [][Symbol.iterator]() },
    };
    await reporter.onTestRunEnd([neverStarted as never], [new Error('boom'), new Error('bang')]);
    const text = lines.join('\n');
    expect(text).toContain('Vitest did not run 1 test file of this run');
    expect(text).toContain('Vitest reported 2 unhandled errors outside the tests');
  });
});
