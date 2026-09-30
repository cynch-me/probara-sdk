import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyStatusRules,
  resolveBooleanSetting,
  resolveConfig,
  type ConfigResolution,
  type ProbaraOptions,
  type ResolvedConfig,
} from './config.js';

const TOKEN = 'probara_secretTOKEN123';
const RUN_ULID = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const ENV_ULID = '01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const now = () => new Date('2026-09-29T14:05:59.000Z');
const credentials = { PROBARA_API_TOKEN: TOKEN, PROBARA_PROJECT: 'SHOP' };

type Env = Record<string, string | undefined>;

function resolveWith(options: ProbaraOptions = {}, env: Env = credentials): ConfigResolution {
  return resolveConfig(options, env, { now });
}

function configOf(options: ProbaraOptions = {}, env: Env = credentials): ResolvedConfig {
  const resolution = resolveWith(options, env);
  if (!resolution.ok) throw new Error(`expected a config, got ${JSON.stringify(resolution)}`);
  return resolution.config;
}

function problemsOf(options: ProbaraOptions, env: Env = credentials): string[] {
  const resolution = resolveWith(options, env);
  if (resolution.ok || resolution.disabled) {
    throw new Error(`expected problems, got ${JSON.stringify(resolution)}`);
  }
  return resolution.problems;
}

describe('resolveConfig', () => {
  it('resolves every default from the token and project in the environment', () => {
    expect(resolveWith()).toEqual({
      ok: true,
      warnings: [],
      config: {
        apiToken: TOKEN,
        projectId: 'SHOP',
        baseUrl: 'https://app.probara.net',
        run: { name: 'Automated run 2026-09-29 14:05 UTC', configurationUlids: [], tags: [] },
        source: {},
        createMissingCases: true,
        closeRun: true,
        rootDir: process.cwd(),
        debug: false,
        chunkSize: 500,
        timeoutMs: 30000,
        maxRetries: 4,
        uploadAttachments: true,
        attachmentConcurrency: 2,
        statusMapping: {},
        statusFilter: [],
      },
    });
  });

  it('reads every setting from PROBARA_* variables', () => {
    const suite = '01J9Z3K4M5N6P7Q8R9S0T1V2W5';
    expect(
      configOf(
        {},
        {
          PROBARA_API_TOKEN: ` ${TOKEN} `,
          PROBARA_PROJECT: ' WEB ',
          PROBARA_BASE_URL: 'https://probara.acme.test/',
          PROBARA_RUN_NAME: 'Nightly',
          PROBARA_ENVIRONMENT_ID: RUN_ULID.toLowerCase(),
          PROBARA_MILESTONE_ID: ENV_ULID,
          PROBARA_CONFIGURATION_ULIDS: `${RUN_ULID}, ${ENV_ULID.toLowerCase()} ,`,
          PROBARA_RUN_TAGS: 'nightly, smoke',
          PROBARA_CREATE_MISSING_CASES: 'false',
          PROBARA_SUITE_ULID: suite,
          PROBARA_CLOSE_RUN: 'no',
          PROBARA_DEBUG: '1',
          PROBARA_UPLOAD_ATTACHMENTS: 'off',
          PROBARA_STATUS_MAPPING: 'failed=blocked',
          PROBARA_STATUS_FILTER: 'skipped',
        },
      ),
    ).toEqual({
      apiToken: TOKEN,
      projectId: 'WEB',
      baseUrl: 'https://probara.acme.test',
      run: {
        name: 'Nightly',
        environmentId: RUN_ULID,
        milestoneId: ENV_ULID,
        configurationUlids: [RUN_ULID, ENV_ULID],
        tags: ['nightly', 'smoke'],
      },
      source: {},
      createMissingCases: false,
      suiteUlid: suite,
      closeRun: false,
      rootDir: process.cwd(),
      debug: true,
      chunkSize: 500,
      timeoutMs: 30000,
      maxRetries: 4,
      uploadAttachments: false,
      attachmentConcurrency: 2,
      statusMapping: { failed: 'blocked' },
      statusFilter: ['skipped'],
    });
  });

  it('lets explicit options win over the environment, and never lets undefined overwrite it', () => {
    const env = {
      ...credentials,
      PROBARA_BASE_URL: 'https://env.acme.test',
      PROBARA_RUN_NAME: 'From env',
      PROBARA_DEBUG: 'true',
      PROBARA_UPLOAD_ATTACHMENTS: 'false',
    };
    const config = configOf(
      {
        apiToken: 'probara_other',
        projectId: 'OPT',
        baseUrl: 'http://localhost:8787',
        run: { name: 'From options', tags: undefined },
        debug: false,
        createMissingCases: undefined,
        clientName: 'probara-playwright/0.1.0',
        rootDir: 'e2e',
        chunkSize: 100,
        timeoutMs: 5000,
        maxRetries: 0,
        uploadAttachments: true,
        attachmentConcurrency: 8,
      },
      env,
    );
    expect(config).toMatchObject({
      apiToken: 'probara_other',
      projectId: 'OPT',
      baseUrl: 'http://localhost:8787',
      run: { name: 'From options', tags: [] },
      debug: false,
      createMissingCases: true,
      clientName: 'probara-playwright/0.1.0',
      rootDir: resolve('e2e'),
      chunkSize: 100,
      timeoutMs: 5000,
      maxRetries: 0,
      uploadAttachments: true,
      attachmentConcurrency: 8,
    });
    expect(configOf({ apiToken: undefined, baseUrl: undefined }, env)).toMatchObject({
      apiToken: TOKEN,
      baseUrl: 'https://env.acme.test',
    });
  });

  it('treats blank values as unset', () => {
    expect(configOf({ projectId: '  ' }, { ...credentials, PROBARA_BASE_URL: ' ' })).toMatchObject({
      projectId: 'SHOP',
      baseUrl: 'https://app.probara.net',
    });
  });

  it('returns an immutable config', () => {
    const config = configOf({ run: { tags: ['a'] } });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.run)).toBe(true);
    expect(Object.isFrozen(config.source)).toBe(true);
    if ('tags' in config.run) expect(Object.isFrozen(config.run.tags)).toBe(true);
  });

  describe('enabling', () => {
    it('is disabled by enabled: false or a false PROBARA_ENABLED, in any case', () => {
      expect(resolveWith({ enabled: false })).toEqual({
        ok: false,
        disabled: true,
        cause: 'disabled',
        reason: 'Probara reporting is disabled by the enabled option',
        warnings: [],
      });
      for (const value of ['false', '0', 'No', 'OFF']) {
        expect(resolveWith({}, { ...credentials, PROBARA_ENABLED: value })).toEqual({
          ok: false,
          disabled: true,
          cause: 'disabled',
          reason: 'Probara reporting is disabled by PROBARA_ENABLED',
          warnings: [],
        });
      }
    });

    it('lets enabled: true win over a false PROBARA_ENABLED', () => {
      expect(resolveWith({ enabled: true }, { ...credentials, PROBARA_ENABLED: 'false' }).ok).toBe(
        true,
      );
      expect(resolveWith({}, { ...credentials, PROBARA_ENABLED: 'yes' }).ok).toBe(true);
    });

    it('stays quietly disabled when neither a token nor a project is configured', () => {
      expect(resolveWith({}, {})).toEqual({
        ok: false,
        disabled: true,
        cause: 'not_configured',
        reason:
          'Probara reporting is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT to enable it',
        warnings: [],
      });
    });

    it('says reporting was turned off, not left unconfigured, when both hold', () => {
      const off = resolveWith({}, { PROBARA_ENABLED: 'false' });
      expect(!off.ok && off.disabled && off.cause).toBe('disabled');
      const unconfigured = resolveWith({ enabled: true }, {});
      expect(!unconfigured.ok && unconfigured.disabled && unconfigured.cause).toBe(
        'not_configured',
      );
    });

    it('reports the missing half when only the token or only the project is set', () => {
      expect(problemsOf({}, { PROBARA_API_TOKEN: TOKEN })).toEqual([
        'The project is not set: pass projectId or set PROBARA_PROJECT',
      ]);
      expect(problemsOf({ projectId: 'SHOP' }, {})).toEqual([
        'The API token is not set: pass apiToken or set PROBARA_API_TOKEN',
      ]);
    });
  });

  describe('baseUrl', () => {
    it('must be an http(s) URL without a query or fragment', () => {
      expect(problemsOf({ baseUrl: 'ftp://probara.acme.test' })).toEqual([
        'baseUrl must be an http(s) URL without a query or fragment',
      ]);
      expect(problemsOf({}, { ...credentials, PROBARA_BASE_URL: 'app.probara.net' })).toEqual([
        'PROBARA_BASE_URL must be an http(s) URL without a query or fragment',
      ]);
      expect(problemsOf({ baseUrl: 'https://app.probara.net/?x=1' })).toHaveLength(1);
    });

    it('keeps a path prefix without its trailing slashes', () => {
      expect(configOf({ baseUrl: 'https://acme.test/probara//' }).baseUrl).toBe(
        'https://acme.test/probara',
      );
    });
  });

  describe('run', () => {
    it('reuses a run by ULID, trimmed and uppercased, and leaves it open by default', () => {
      const config = configOf({ run: { ulid: ` ${RUN_ULID.toLowerCase()} ` } });
      expect(config.run).toEqual({ ulid: RUN_ULID });
      expect(config.closeRun).toBe(false);
      expect(configOf({}, { ...credentials, PROBARA_RUN_ULID: ENV_ULID }).run).toEqual({
        ulid: ENV_ULID,
      });
    });

    it('closes a reused run only when asked', () => {
      expect(configOf({ run: { ulid: RUN_ULID }, closeRun: true }).closeRun).toBe(true);
      expect(
        configOf({}, { ...credentials, PROBARA_RUN_ULID: RUN_ULID, PROBARA_CLOSE_RUN: 'true' })
          .closeRun,
      ).toBe(true);
      expect(configOf({ closeRun: false }).closeRun).toBe(false);
    });

    it('ignores new-run fields with a warning when reusing a run', () => {
      const env = { ...credentials, PROBARA_RUN_ULID: RUN_ULID, PROBARA_RUN_TAGS: 'smoke' };
      const resolution = resolveWith({ run: { name: 'Nightly', milestoneId: ENV_ULID } }, env);
      expect(resolution).toMatchObject({ ok: true, config: { run: { ulid: RUN_ULID } } });
      expect(resolution.warnings).toEqual([
        'Ignored name, milestoneId and tags: a reused run (run.ulid) keeps its own',
      ]);
    });

    it('rejects ids that are not ULIDs, naming where they came from', () => {
      expect(
        problemsOf(
          { run: { ulid: 'run-1' }, suiteUlid: 'suite' },
          { ...credentials, PROBARA_ENVIRONMENT_ID: 'staging' },
        ),
      ).toEqual(['run.ulid is not a ULID', 'suiteUlid is not a ULID']);
      expect(
        problemsOf(
          {},
          {
            ...credentials,
            PROBARA_ENVIRONMENT_ID: 'staging',
            PROBARA_MILESTONE_ID: 'm1',
            PROBARA_CONFIGURATION_ULIDS: `${RUN_ULID},chrome`,
            PROBARA_SUITE_ULID: 'root',
          },
        ),
      ).toEqual([
        'PROBARA_ENVIRONMENT_ID is not a ULID',
        'PROBARA_MILESTONE_ID is not a ULID',
        'PROBARA_CONFIGURATION_ULIDS holds a value that is not a ULID',
        'PROBARA_SUITE_ULID is not a ULID',
      ]);
    });

    it('rejects more than 20 configuration ULIDs', () => {
      const ulids = Array.from(
        { length: 21 },
        (_, i) => `01J9Z3K4M5N6P7Q8R9S0T1V2${String(i).padStart(2, '0')}`,
      );
      expect(configOf({ run: { configurationUlids: ulids.slice(0, 20) } }).run).toMatchObject({
        configurationUlids: ulids.slice(0, 20),
      });
      expect(problemsOf({ run: { configurationUlids: ulids } })).toEqual([
        'run.configurationUlids holds more than 20 ULIDs',
      ]);
    });

    it('cleans tags: trimmed, blank dropped, de-duplicated, truncated and capped at 50', () => {
      expect(configOf({ run: { tags: [' smoke ', '', 'smoke', 'ui', '  '] } }).run).toMatchObject({
        tags: ['smoke', 'ui'],
      });
      const long = configOf({ run: { tags: ['t'.repeat(90)] } }).run;
      expect(long).toMatchObject({ tags: [`${'t'.repeat(79)}…`] });

      const tags = Array.from({ length: 53 }, (_, i) => `tag-${i}`);
      const resolution = resolveWith({ run: { tags } });
      expect(resolution).toMatchObject({ ok: true, config: { run: { tags: tags.slice(0, 50) } } });
      expect(resolution.warnings).toEqual(['Dropped 3 run tags beyond the limit of 50']);
    });

    it('normalizes the name to one line and truncates it to 200 characters with a warning', () => {
      expect(configOf({ run: { name: '  Nightly\n\tsmoke  ' } }).run).toMatchObject({
        name: 'Nightly smoke',
      });
      const resolution = resolveWith({ run: { name: 'n'.repeat(250) } });
      expect(resolution).toMatchObject({
        ok: true,
        config: { run: { name: `${'n'.repeat(199)}…` } },
      });
      expect(resolution.warnings).toEqual(['Truncated the run name to 200 characters']);
    });

    it('names a new run after the CI build when there is one', () => {
      const env = {
        ...credentials,
        GITHUB_ACTIONS: 'true',
        GITHUB_WORKFLOW: 'E2E',
        GITHUB_RUN_NUMBER: '314',
      };
      expect(configOf({}, env).run).toMatchObject({ name: 'E2E #314' });
      expect(configOf({ run: { name: 'Mine' } }, env).run).toMatchObject({ name: 'Mine' });
    });
  });

  describe('source', () => {
    const githubEnv = {
      ...credentials,
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: 'a1b2c3',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_RUN_ID: '9',
    };

    it('is detected from the CI environment', () => {
      expect(configOf({}, githubEnv).source).toEqual({
        branch: 'main',
        commit: 'a1b2c3',
        buildUrl: 'https://github.com/acme/shop/actions/runs/9',
      });
    });

    it('takes explicit fields over detected ones, field by field', () => {
      expect(configOf({ source: { branch: 'release' } }, githubEnv).source).toEqual({
        branch: 'release',
        commit: 'a1b2c3',
        buildUrl: 'https://github.com/acme/shop/actions/runs/9',
      });
    });

    it('treats an explicit blank field as unset, falling back to the detected value', () => {
      const resolution = resolveWith({ source: { branch: '  ', commit: '' } }, githubEnv);
      expect(resolution).toMatchObject({
        ok: true,
        warnings: [],
        config: { source: { branch: 'main', commit: 'a1b2c3' } },
      });
      expect(configOf({ source: { branch: ' ' } }).source).toEqual({});
    });

    it('is not sent at all with source: false', () => {
      expect(configOf({ source: false }, githubEnv).source).toEqual({});
    });

    it('drops invalid fields with a warning', () => {
      const resolution = resolveWith({ source: { commit: 'not a sha' } }, githubEnv);
      expect(resolution).toMatchObject({ ok: true, config: { source: { branch: 'main' } } });
      expect(resolution.ok && resolution.config.source).not.toHaveProperty('commit');
      expect(resolution.warnings).toEqual([
        'Ignored a source commit that is not 1 to 64 visible ASCII characters',
      ]);
    });
    it('drops explicit fields that are not strings with a warning instead of throwing', () => {
      const wrong = { branch: 42, commit: ['a1b2c3'], buildUrl: { href: 'x' } };
      const resolution = resolveWith({ source: wrong as unknown as ProbaraOptions['source'] });
      expect(resolution).toMatchObject({ ok: true, config: { source: {} } });
      expect(resolution.warnings).toEqual([
        'Ignored source.branch: it must be a string',
        'Ignored source.commit: it must be a string',
        'Ignored source.buildUrl: it must be a string',
      ]);
      const mixed = resolveWith(
        { source: { branch: 7, commit: 'a1b2c3' } as unknown as ProbaraOptions['source'] },
        githubEnv,
      );
      expect(mixed).toMatchObject({
        ok: true,
        config: {
          source: { commit: 'a1b2c3', buildUrl: 'https://github.com/acme/shop/actions/runs/9' },
        },
      });
      expect(mixed.ok && mixed.config.source).not.toHaveProperty('branch');
    });
  });

  describe('invalid values', () => {
    it('reports a boolean variable that is not a boolean, naming the variable', () => {
      expect(
        problemsOf(
          {},
          {
            ...credentials,
            PROBARA_ENABLED: 'maybe',
            PROBARA_CLOSE_RUN: 'sure',
            PROBARA_CREATE_MISSING_CASES: '2',
            PROBARA_DEBUG: 'verbose',
            PROBARA_UPLOAD_ATTACHMENTS: 'all',
          },
        ),
      ).toEqual([
        'PROBARA_ENABLED must be true or false',
        'PROBARA_CREATE_MISSING_CASES must be true or false',
        'PROBARA_CLOSE_RUN must be true or false',
        'PROBARA_DEBUG must be true or false',
        'PROBARA_UPLOAD_ATTACHMENTS must be true or false',
      ]);
    });

    it('reports options of the wrong type instead of throwing', () => {
      const wrong = {
        apiToken: 42,
        projectId: { code: 'SHOP' },
        baseUrl: ['https://app.probara.test'],
        closeRun: 'no',
        debug: 1,
      } as unknown as ProbaraOptions;
      expect(problemsOf(wrong)).toEqual([
        'apiToken must be a string',
        'projectId must be a string',
        'baseUrl must be a string',
        'closeRun must be true or false',
        'debug must be true or false',
      ]);
    });

    it('reports list options that are not lists of strings instead of throwing', () => {
      const run = (value: unknown) => value as string[];
      expect(
        problemsOf({ run: { tags: run('nightly'), configurationUlids: run(RUN_ULID) } }),
      ).toEqual([
        'run.configurationUlids must be a list of strings',
        'run.tags must be a list of strings',
      ]);
      expect(
        problemsOf({ run: { tags: run(['ok', 3]), configurationUlids: run([RUN_ULID, null]) } }),
      ).toEqual([
        'run.configurationUlids must be a list of strings',
        'run.tags must be a list of strings',
      ]);
      expect(configOf({ run: { tags: ['ok'], configurationUlids: [RUN_ULID] } }).run).toEqual(
        expect.objectContaining({ tags: ['ok'], configurationUlids: [RUN_ULID] }),
      );
    });

    it('reports a rootDir or clientName that is not a string instead of throwing', () => {
      expect(
        problemsOf({ rootDir: 1, clientName: { name: 'x' } } as unknown as ProbaraOptions),
      ).toEqual(['rootDir must be a string', 'clientName must be a string']);
    });

    it('reports numbers out of range', () => {
      expect(problemsOf({ chunkSize: 501, timeoutMs: 0, maxRetries: -1 })).toEqual([
        'chunkSize must be an integer from 1 to 500',
        'timeoutMs must be an integer from 1 to 600000',
        'maxRetries must be an integer from 0 to 10',
      ]);
      expect(problemsOf({ chunkSize: 2.5, timeoutMs: Number.NaN, maxRetries: 1.5 })).toHaveLength(
        3,
      );
      expect(problemsOf({ timeoutMs: 600_001, maxRetries: 11 })).toHaveLength(2);
      expect(problemsOf({ timeoutMs: 1.5 })).toEqual([
        'timeoutMs must be an integer from 1 to 600000',
      ]);
      for (const attachmentConcurrency of [0, 9, 1.5]) {
        expect(problemsOf({ attachmentConcurrency })).toEqual([
          'attachmentConcurrency must be an integer from 1 to 8',
        ]);
      }
      expect(configOf({ attachmentConcurrency: 1 }).attachmentConcurrency).toBe(1);
      expect(configOf({ chunkSize: 1 }).chunkSize).toBe(1);
      expect(configOf({ timeoutMs: 600_000, maxRetries: 10 })).toMatchObject({
        timeoutMs: 600_000,
        maxRetries: 10,
      });
    });

    it('reads the status mapping and filter, trimmed, in any case, without blank entries', () => {
      expect(
        configOf(
          {},
          {
            ...credentials,
            PROBARA_STATUS_MAPPING: ' Failed = BLOCKED , skipped=passed ,',
            PROBARA_STATUS_FILTER: 'passed, SKIPPED,,passed',
          },
        ),
      ).toMatchObject({
        statusMapping: { failed: 'blocked', skipped: 'passed' },
        statusFilter: ['passed', 'skipped'],
      });
    });

    it('takes the status mapping and filter options over their variables', () => {
      const env = {
        ...credentials,
        PROBARA_STATUS_MAPPING: 'failed=blocked',
        PROBARA_STATUS_FILTER: 'skipped',
      };
      expect(
        configOf({ statusMapping: { blocked: 'failed' }, statusFilter: ['passed'] }, env),
      ).toMatchObject({ statusMapping: { blocked: 'failed' }, statusFilter: ['passed'] });
      expect(configOf({ statusMapping: {}, statusFilter: [] }, env)).toMatchObject({
        statusMapping: {},
        statusFilter: [],
      });
    });

    it('reports a malformed status mapping or filter variable, never echoing it', () => {
      const problem = (variable: string, value: string) =>
        problemsOf({}, { ...credentials, [variable]: value });
      const mapping =
        'PROBARA_STATUS_MAPPING must be a comma-separated list of <status>=<status> (statuses: passed, failed, skipped, blocked)';
      for (const value of ['failed', 'failed=', 'failed=nope', 'timedOut=failed', 'a=b=c']) {
        expect(problem('PROBARA_STATUS_MAPPING', value)).toEqual([mapping]);
      }
      expect(problem('PROBARA_STATUS_MAPPING', 'failed=blocked, FAILED=passed')).toEqual([
        'PROBARA_STATUS_MAPPING maps a status twice',
      ]);
      expect(problem('PROBARA_STATUS_FILTER', 'passed, flaky')).toEqual([
        'PROBARA_STATUS_FILTER holds a value that is not a status (passed, failed, skipped, blocked)',
      ]);
      expect(problem('PROBARA_STATUS_FILTER', `passed,${TOKEN}`).join()).not.toContain(TOKEN);
    });

    it('reports status mapping and filter options of the wrong shape instead of throwing', () => {
      const wrong = (options: unknown) => problemsOf(options as ProbaraOptions);
      const mapping =
        'statusMapping must map statuses to statuses (passed, failed, skipped, blocked)';
      const filter = 'statusFilter must be a list of statuses (passed, failed, skipped, blocked)';
      for (const statusMapping of [
        'failed=blocked',
        ['failed'],
        null,
        { failed: 'nope' },
        { timedOut: 'failed' },
      ]) {
        expect(wrong({ statusMapping })).toEqual([mapping]);
      }
      for (const statusFilter of ['passed', [1], ['flaky'], null]) {
        expect(wrong({ statusFilter })).toEqual([filter]);
      }
    });

    it('never echoes the token in a reason, problem or warning', () => {
      const misplaced = resolveWith({
        baseUrl: `ftp://${TOKEN}`,
        run: { ulid: TOKEN },
        suiteUlid: TOKEN,
      });
      expect(misplaced).toMatchObject({ ok: false, disabled: false });
      expect(!misplaced.ok && !misplaced.disabled && misplaced.problems).toHaveLength(3);
      const messages = [
        misplaced,
        resolveWith({ projectId: TOKEN }, { PROBARA_API_TOKEN: undefined }),
        resolveWith({ source: { commit: `${TOKEN} x`, buildUrl: TOKEN } }),
        resolveWith(
          {},
          { ...credentials, PROBARA_ENABLED: TOKEN, PROBARA_CONFIGURATION_ULIDS: TOKEN },
        ),
        resolveWith({ enabled: false, apiToken: TOKEN }),
      ].map((resolution) => JSON.stringify({ ...resolution, config: undefined }));
      for (const message of messages) expect(message).not.toContain(TOKEN);
    });
  });
});

describe('applyStatusRules', () => {
  const rules = {
    statusMapping: { failed: 'blocked', skipped: 'passed' },
    statusFilter: ['passed'],
  } as const;

  it('maps the status first, then says whether the filter leaves it out', () => {
    expect(applyStatusRules('failed', rules)).toEqual({ status: 'blocked', filtered: false });
    expect(applyStatusRules('skipped', rules)).toEqual({ status: 'passed', filtered: true });
    expect(applyStatusRules('passed', rules)).toEqual({ status: 'passed', filtered: true });
    expect(applyStatusRules('blocked', rules)).toEqual({ status: 'blocked', filtered: false });
  });

  it('keeps every status as it is without rules', () => {
    expect(applyStatusRules('failed', { statusMapping: {}, statusFilter: [] })).toEqual({
      status: 'failed',
      filtered: false,
    });
  });
});

describe('resolveBooleanSetting', () => {
  const variable = 'PROBARA_CAPTURE_OUTPUT';

  it('takes the option over its variable', () => {
    expect(resolveBooleanSetting(true, 'captureOutput', variable, { [variable]: 'false' })).toEqual(
      {
        value: true,
      },
    );
    expect(resolveBooleanSetting(false, 'captureOutput', variable, { [variable]: 'on' })).toEqual({
      value: false,
    });
  });

  it('reads the variable like core does, in any case and trimmed, when the option is unset', () => {
    expect(
      resolveBooleanSetting(undefined, 'captureOutput', variable, { [variable]: ' YES ' }),
    ).toEqual({
      value: true,
    });
    expect(
      resolveBooleanSetting(undefined, 'captureOutput', variable, { [variable]: '0' }),
    ).toEqual({
      value: false,
    });
  });

  it('has no value when neither is set, or the variable is blank', () => {
    expect(resolveBooleanSetting(undefined, 'captureOutput', variable, {})).toEqual({});
    expect(
      resolveBooleanSetting(undefined, 'captureOutput', variable, { [variable]: ' ' }),
    ).toEqual({});
  });

  it('names the variable or the option that is not a boolean, never echoing its value', () => {
    expect(
      resolveBooleanSetting(undefined, 'captureOutput', variable, { [variable]: 'verbose' }),
    ).toEqual({
      problem: 'PROBARA_CAPTURE_OUTPUT must be true or false',
    });
    expect(resolveBooleanSetting('yes', 'captureOutput', variable, {})).toEqual({
      problem: 'captureOutput must be true or false',
    });
  });
});
