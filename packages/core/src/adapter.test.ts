import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdapterSession,
  linksOnlyUnlistedProjects,
  logAdapterError,
  resolveAdapterSetup,
} from './adapter.js';
import type { Logger } from './logger.js';
import type { TestResultInput } from './result.js';

const TOKEN = 'probara_app_secret-token';

function recordingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => lines.push(`debug: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
  return { lines, logger };
}

function result(status: TestResultInput['status'], ids: string[] = []): TestResultInput {
  return {
    identity: { titlePath: ['a test'] },
    status,
    ...(ids.length === 1 ? { caseDisplayId: ids[0] } : {}),
    ...(ids.length > 1 ? { caseDisplayIds: ids } : {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveAdapterSetup', () => {
  const context = { rootDir: '/work/shop', clientName: 'probara-jest-reporter/1.0.0' };

  it('gives core the options with the adapter root, client name and a logger on stderr', () => {
    const env = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP', PROBARA_PROJECTS: 'WEB,API' };
    const setup = resolveAdapterSetup({ env, statusFilter: ['skipped'] }, context);

    expect(setup.core).toMatchObject({
      env,
      rootDir: '/work/shop',
      clientName: 'probara-jest-reporter/1.0.0',
      statusFilter: ['skipped'],
    });
    expect(setup.core.adapterProblems).toBeUndefined();
    expect(setup.projectCodes).toEqual(['SHOP', 'WEB', 'API']);
    expect(setup.statusRules).toMatchObject({ statusMapping: {}, statusFilter: ['skipped'] });

    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    setup.core.logger?.info('hello');
    setup.core.logger?.debug('hidden');
    expect(stderr.mock.calls).toEqual([['[probara] hello']]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('keeps the rootDir and logger the options give, and passes the adapter problems on', () => {
    const { logger } = recordingLogger();
    const setup = resolveAdapterSetup(
      { env: {}, apiToken: TOKEN, projectId: 'WEB', rootDir: '/elsewhere', logger },
      { ...context, adapterProblems: ['captureOutput must be true or false'] },
    );
    expect(setup.core.rootDir).toBe('/elsewhere');
    expect(setup.core.logger).toBe(logger);
    expect(setup.core.adapterProblems).toEqual(['captureOutput must be true or false']);
    expect(setup.projectCodes).toEqual(['WEB']);
  });

  it('logs debug lines when PROBARA_DEBUG is on, even while the configuration has problems', () => {
    const setup = resolveAdapterSetup(
      { env: { PROBARA_DEBUG: 'true', PROBARA_API_TOKEN: TOKEN } },
      context,
    );
    expect(setup.statusRules).toBeUndefined();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup.core.logger?.debug('shown');
    expect(stderr.mock.calls).toEqual([['[probara] shown']]);
  });

  it('still reads the project codes while reporting is off, for the results file', () => {
    const off = resolveAdapterSetup(
      { env: { PROBARA_ENABLED: 'false', PROBARA_PROJECT: 'SHOP', PROBARA_PROJECTS: 'WEB' } },
      context,
    );
    expect(off.projectCodes).toEqual(['SHOP', 'WEB']);
    expect(off.statusRules).toBeUndefined();

    const unconfigured = resolveAdapterSetup({ env: {} }, context);
    expect(unconfigured.projectCodes).toEqual([]);
  });
});

describe('linksOnlyUnlistedProjects', () => {
  it('is true when every linked case belongs to a project that is not listed', () => {
    expect(linksOnlyUnlistedProjects(result('passed', ['API-1']), ['SHOP', 'WEB'])).toBe(true);
    expect(linksOnlyUnlistedProjects(result('passed', ['API-1', 'X-2']), ['SHOP'])).toBe(true);
  });

  it('is false with a listed case, no case, no project, or an id that is not a case id', () => {
    expect(linksOnlyUnlistedProjects(result('passed', ['API-1', 'WEB-2']), ['WEB'])).toBe(false);
    expect(linksOnlyUnlistedProjects(result('passed'), ['WEB'])).toBe(false);
    expect(linksOnlyUnlistedProjects(result('passed', ['API-1']), [])).toBe(false);
    expect(linksOnlyUnlistedProjects(result('passed', ['not an id']), ['WEB'])).toBe(false);
  });
});

describe('createAdapterSession', () => {
  it('counts results as core sends them, and says so in one line', () => {
    const session = createAdapterSession({
      statusRules: { statusMapping: { skipped: 'blocked' }, statusFilter: ['passed'] },
      projectCodes: ['SHOP'],
    });
    const first = {};
    const second = {};
    session.count(result('failed'), first);
    session.count(result('failed'), first);
    session.count(result('skipped'), second);
    session.count(result('passed'), second);
    session.count(result('failed', ['API-3']), second);
    session.countIgnored();

    expect(session.summaryLine()).toBe(
      'Sending 3 results of 2 tests (0 passed, 2 failed, 0 skipped, 1 blocked); 1 left out by statusFilter; 1 ignored with probara.ignore(); 1 linked only to cases of unlisted projects',
    );
  });

  it('writes one result and one test in the singular, and nothing when nothing was counted', () => {
    const session = createAdapterSession();
    expect(session.summaryLine()).toBeUndefined();
    session.count(result('passed'), 'test');
    expect(session.summaryLine()).toBe(
      'Sending 1 result of 1 test (1 passed, 0 failed, 0 skipped, 0 blocked)',
    );

    const ignoredOnly = createAdapterSession();
    ignoredOnly.countIgnored();
    expect(ignoredOnly.summaryLine()).toBe(
      'Sending 0 results of 0 tests (0 passed, 0 failed, 0 skipped, 0 blocked); 1 ignored with probara.ignore()',
    );
  });

  it('warns about a problem the first time, then logs it at debug', () => {
    const { lines, logger } = recordingLogger();
    const session = createAdapterSession({ logger });
    session.warnOnce('Ignored malformed probara metadata (type "x")', '"pays"');
    session.warnOnce('Ignored malformed probara metadata (type "x")', '"refunds"');
    session.warnOnce('Another problem', '"refunds"');
    expect(lines).toEqual([
      'warn: Ignored malformed probara metadata (type "x") (first seen in "pays"; repeats are logged at debug)',
      'debug: Ignored malformed probara metadata (type "x") ("refunds")',
      'warn: Another problem (first seen in "refunds"; repeats are logged at debug)',
    ]);
  });
});

describe('logAdapterError', () => {
  it('logs one error line without the token of the options or of the environment', () => {
    const { lines, logger } = recordingLogger();
    logAdapterError(`failed with ${TOKEN}`, { apiToken: ` ${TOKEN} ` }, logger);
    logAdapterError('failed with env-token', { env: { PROBARA_API_TOKEN: 'env-token' } }, logger);
    expect(lines).toEqual(['error: failed with [redacted]', 'error: failed with [redacted]']);
  });

  it("uses the options' logger, else the console on stderr, whatever the options are", () => {
    const { lines, logger } = recordingLogger();
    logAdapterError('from options', { logger });
    expect(lines).toEqual(['error: from options']);

    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logAdapterError('no options', null);
    logAdapterError('odd options', 42);
    expect(stderr.mock.calls).toEqual([['[probara] no options'], ['[probara] odd options']]);
  });

  it('never throws, even when the logger does', () => {
    const throwing: Logger = {
      debug() {},
      info() {},
      warn() {},
      error() {
        throw new Error('broken logger');
      },
    };
    expect(() => {
      logAdapterError('x', {}, throwing);
    }).not.toThrow();
    const hostile = Object.defineProperty({}, 'apiToken', {
      get() {
        throw new Error('hostile getter');
      },
    });
    expect(() => {
      logAdapterError('x', hostile, throwing);
    }).not.toThrow();
  });
});
