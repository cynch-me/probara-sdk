import type { CreateRunRequest } from '@probara/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { optionsOf } from '../src/options.js';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { configuredEnv, linesWith, runCli, TOKEN, type CliRun } from './support/run-cli.js';

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

async function probara(
  args: readonly string[],
  env: Record<string, string | undefined> = configuredEnv(fake.baseUrl),
): Promise<CliRun> {
  const run = await runCli(args, { env });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

function createdBody(): CreateRunRequest {
  const requests = fake.requestsTo('createRun');
  expect(requests).toHaveLength(1);
  return requests[0]?.body as CreateRunRequest;
}

describe('probara run create', () => {
  it('logs a configuration warning once, whether core runs or not', async () => {
    const longName = 'n'.repeat(250);
    const created = await probara(['run', 'create', '--run-name', longName]);
    const invalid = await probara([
      'run',
      'create',
      '--run-name',
      longName,
      '--base-url',
      'ftp://probara.test',
    ]);
    const refused = await probara(
      ['run', 'create', '--run-name', 'Nightly'],
      configuredEnv(fake.baseUrl, { PROBARA_RUN_ULID: fake.seedRun() }),
    );
    const disabled = await probara(
      ['run', 'create', '--run-name', longName],
      configuredEnv(fake.baseUrl, { PROBARA_ENABLED: 'false' }),
    );

    expect(created.exitCode).toBe(0);
    expect(linesWith(created, 'Truncated the run name to 200 characters')).toBe(1);
    expect(invalid.exitCode).toBe(2);
    expect(linesWith(invalid, 'Truncated the run name to 200 characters')).toBe(1);
    expect(refused.exitCode).toBe(2);
    expect(linesWith(refused, 'Ignored name: a reused run (run.ulid) keeps its own')).toBe(1);
    expect(disabled.exitCode).toBe(0);
    expect(linesWith(disabled, 'Truncated the run name to 200 characters')).toBe(1);
  });

  it('prints only the ULID of the created run on stdout', async () => {
    const result = await probara(['run', 'create', '--run-name', 'Nightly']);

    expect(result.exitCode).toBe(0);
    const [run] = fake.runs();
    expect(result.stdout).toBe(`${run?.ulid ?? ''}\n`);
    expect(result.stderr).toContain(
      `[probara] Created the run R-1: ${fake.baseUrl}/projects/PRB/runs/R-1`,
    );
    expect(fake.requestsTo('createRun')[0]).toMatchObject({
      projectId: 'PRB',
      headers: { 'idempotency-key': expect.any(String) as string },
    });
  });

  it('describes the run from flags over the environment', async () => {
    await probara(
      [
        'run',
        'create',
        '--project',
        'PRB',
        '--run-name',
        'Shards',
        '--tag',
        'ci,nightly',
        '--configuration',
        '01KC0000000000000000000001',
        '--environment-id',
        '01KE0000000000000000000001',
        '--milestone-id',
        '01KM0000000000000000000001',
        '--branch',
        'feature/x',
      ],
      configuredEnv(fake.baseUrl, {
        PROBARA_PROJECT: 'OTHER',
        PROBARA_RUN_NAME: 'From env',
        PROBARA_RUN_TAGS: 'env',
        PROBARA_BRANCH: 'main',
        PROBARA_COMMIT: 'c'.repeat(40),
      }),
    );

    expect(fake.requestsTo('createRun')[0]?.projectId).toBe('PRB');
    expect(createdBody()).toEqual({
      name: 'Shards',
      tags: ['ci', 'nightly'],
      configurationUlids: ['01KC0000000000000000000001'],
      environmentId: '01KE0000000000000000000001',
      milestoneId: '01KM0000000000000000000001',
      source: { branch: 'feature/x', commit: 'c'.repeat(40) },
      automated: true,
    });
  });

  it('names the environment, milestone, plan and configurations of the run, and describes it', async () => {
    const result = await probara([
      'run',
      'create',
      '--run-description',
      'Every night',
      '--environment',
      'staging',
      '--milestone',
      'M-3',
      '--plan',
      'Release plan',
      '--configuration-value',
      'Browser=Chrome',
      '--configuration-value',
      'OS=Linux=LTS',
    ]);

    expect(result.exitCode).toBe(0);
    expect(createdBody()).toMatchObject({
      description: 'Every night',
      environment: 'staging',
      milestone: 'M-3',
      plan: 'Release plan',
      configurations: [
        { group: 'Browser', name: 'Chrome' },
        { group: 'OS', name: 'Linux=LTS' },
      ],
    });
  });

  it('is a usage error (2) for a configuration value that is not <group>=<name>, or both forms of one reference', async () => {
    const malformed = await probara(['run', 'create', '--configuration-value', 'Chrome']);
    const both = await probara([
      'run',
      'create',
      '--environment',
      'staging',
      '--environment-id',
      '01KE0000000000000000000001',
    ]);

    expect(malformed.exitCode).toBe(2);
    expect(malformed.stderr).toContain(
      '--configuration-value takes <group>=<name> pairs, such as Browser=Chrome',
    );
    expect(both.exitCode).toBe(2);
    expect(both.stderr).toContain(
      'run.environmentId and run.environment both name the environment of the run: set one of them',
    );
    expect(fake.requests).toHaveLength(0);
  });

  it('describes the run from the environment without flags', async () => {
    await probara(
      ['run', 'create'],
      configuredEnv(fake.baseUrl, {
        PROBARA_RUN_NAME: 'From env',
        PROBARA_RUN_TAGS: 'a,b',
        PROBARA_BRANCH: 'main',
      }),
    );

    expect(createdBody()).toEqual({
      name: 'From env',
      tags: ['a', 'b'],
      source: { branch: 'main' },
      automated: true,
    });
  });

  it('sends no source with --no-source', async () => {
    await probara(
      ['run', 'create', '--no-source'],
      configuredEnv(fake.baseUrl, { PROBARA_BRANCH: 'main' }),
    );

    expect(createdBody()).not.toHaveProperty('source');
  });

  it('prints { status, run } with --json', async () => {
    const result = await probara(['run', 'create', '--json']);

    expect(JSON.parse(result.stdout)).toEqual({
      status: 'created',
      run: {
        ulid: fake.runs()[0]?.ulid,
        displayId: 'R-1',
        state: 'open',
        url: `${fake.baseUrl}/projects/PRB/runs/R-1`,
      },
    });
  });

  it('is a configuration error (2) when PROBARA_RUN_ULID is already set, before any request', async () => {
    const result = await probara(
      ['run', 'create'],
      configuredEnv(fake.baseUrl, { PROBARA_RUN_ULID: fake.seedRun() }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('PROBARA_RUN_ULID is already set');
    expect(result.stdout).toBe('');
    expect(fake.requests).toHaveLength(0);
  });

  it('is a configuration error (2) when not configured or misconfigured', async () => {
    const unconfigured = await probara(['run', 'create'], { PROBARA_BASE_URL: fake.baseUrl });
    const invalid = await probara(['run', 'create', '--environment-id', 'staging']);

    expect(unconfigured.exitCode).toBe(2);
    expect(unconfigured.stderr).toContain('PROBARA_API_TOKEN');
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain('run.environmentId is not a ULID');
    expect(fake.requests).toHaveLength(0);
  });

  it('prints nothing and exits 0 when disabled by PROBARA_ENABLED', async () => {
    const plain = await probara(
      ['run', 'create'],
      configuredEnv(fake.baseUrl, { PROBARA_ENABLED: 'false' }),
    );
    const json = await probara(
      ['run', 'create', '--json'],
      configuredEnv(fake.baseUrl, { PROBARA_ENABLED: 'false' }),
    );

    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toBe('');
    expect(plain.stderr).toContain('disabled by PROBARA_ENABLED: no run was created');
    expect(JSON.parse(json.stdout)).toEqual({ status: 'disabled' });
    expect(fake.requests).toHaveLength(0);
  });

  it('exits 1 when the creation fails at runtime, and says a run may exist', async () => {
    fake.fail('createRun', { status: 503 });
    const result = await probara(['run', 'create', '--max-retries', '1']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(fake.requestsTo('createRun')).toHaveLength(2);
    // One key for every attempt, so a replay never creates a second run.
    const [first, retry] = fake.requestsTo('createRun');
    expect(retry?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
    expect(result.stderr).toContain('A run may have been created anyway');
  });

  it('exits 1 on a refusal, with the error in --json', async () => {
    fake.fail('createRun', { status: 403 });
    const result = await probara(['run', 'create', '--json']);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      error: { status: 403, code: 'forbidden' },
    });
  });
});

describe('probara run close', () => {
  it('closes the run of PROBARA_RUN_ULID', async () => {
    const ulid = fake.seedRun();
    const result = await probara(
      ['run', 'close'],
      configuredEnv(fake.baseUrl, { PROBARA_RUN_ULID: ulid }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(fake.run(ulid)?.state).toBe('closed');
    expect(result.stderr).toContain('[probara] Closed the run R-1');
  });

  it('closes the run of --run-ulid over PROBARA_RUN_ULID', async () => {
    const other = fake.seedRun();
    const ulid = fake.seedRun();
    const result = await probara(
      ['run', 'close', '--run-ulid', ulid, '--json'],
      configuredEnv(fake.baseUrl, { PROBARA_RUN_ULID: other }),
    );

    expect(fake.run(ulid)?.state).toBe('closed');
    expect(fake.run(other)?.state).toBe('open');
    expect(JSON.parse(result.stdout)).toEqual({
      status: 'closed',
      run: {
        ulid,
        displayId: 'R-2',
        state: 'closed',
        url: `${fake.baseUrl}/projects/PRB/runs/R-2`,
      },
    });
  });

  it('exits 0 when the run was already closed (409)', async () => {
    const ulid = fake.seedRun({ state: 'closed' });
    const result = await probara(['run', 'close', '--run-ulid', ulid, '--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: 'already_closed' });
    expect(result.stderr).toContain('already closed or aborted');
  });

  it('exits 1 when the close fails at runtime', async () => {
    const ulid = fake.seedRun();
    fake.fail('closeRun', { status: 500 }, { times: 1 });
    const failed = await probara(['run', 'close', '--run-ulid', ulid, '--max-retries', '0']);
    const unknown = await probara(['run', 'close', '--run-ulid', '01KZ0000000000000000000001']);

    expect(failed.exitCode).toBe(1);
    expect(fake.run(ulid)?.state).toBe('open');
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('404');
  });

  it('is a configuration error (2) without a run ULID, before any request', async () => {
    const missing = await probara(['run', 'close']);
    const invalid = await probara(['run', 'close', '--run-ulid', 'R-12']);

    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('The run is not set: pass --run-ulid or set PROBARA_RUN_ULID');
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain('run.ulid is not a ULID');
    expect(fake.requests).toHaveLength(0);
  });

  it('exits 0 and sends nothing when disabled by PROBARA_ENABLED', async () => {
    const ulid = fake.seedRun();
    const env = configuredEnv(fake.baseUrl, { PROBARA_ENABLED: '0' });
    const result = await probara(['run', 'close', '--run-ulid', ulid], env);
    const json = await probara(['run', 'close', '--run-ulid', ulid, '--json'], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '[probara] Probara reporting is disabled by PROBARA_ENABLED: no run was closed',
    );
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ status: 'disabled' });
    expect(fake.requests).toHaveLength(0);
    expect(fake.run(ulid)?.state).toBe('open');
  });

  it('does not take the options of a new run', async () => {
    const result = await probara(['run', 'close', '--run-name', 'x']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option '--run-name'");
  });
});

describe('configuration of the run commands', () => {
  it('is an error (2) on a blank project or token, before any request', async () => {
    const env = configuredEnv(fake.baseUrl);
    const flag = await probara(['run', 'create', '--project', '  '], {
      ...env,
      PROBARA_PROJECT: undefined,
    });
    const variable = await probara(['run', 'create'], { ...env, PROBARA_PROJECT: ' ' });
    const token = await probara(['run', 'close', '--run-ulid', fake.seedRun()], {
      ...env,
      PROBARA_API_TOKEN: ' ',
    });

    for (const result of [flag, variable]) {
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        '[probara] The project is not set: pass --project or set PROBARA_PROJECT',
      );
    }
    expect(token.exitCode).toBe(2);
    expect(token.stderr).toContain('[probara] PROBARA_API_TOKEN is not set');
    expect(fake.requests).toHaveLength(0);
  });

  it('is an error (2) on a project that is not a project code, before any request', async () => {
    const env = configuredEnv(fake.baseUrl);
    const create = await probara(['run', 'create'], { ...env, PROBARA_PROJECT: 'prb' });
    const close = await probara(['run', 'close', '--run-ulid', fake.seedRun(), '--project', 'Prb']);

    expect(create.exitCode).toBe(2);
    expect(create.stderr).toContain(
      '[probara] PROBARA_PROJECT is not a project code (capital letters and digits, such as WEB)',
    );
    expect(close.exitCode).toBe(2);
    expect(close.stderr).toContain(
      '[probara] projectId is not a project code (capital letters and digits, such as WEB)',
    );
    expect(fake.requests).toHaveLength(0);
  });

  it('is an error (2) when not configured, naming what to set', async () => {
    const result = await probara(['run', 'create'], { PROBARA_BASE_URL: fake.baseUrl });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      '[probara] Probara is not configured: set PROBARA_API_TOKEN and PROBARA_PROJECT (or pass --project)',
    );
    expect(fake.requests).toHaveLength(0);
  });
});

describe('stray arguments of the run commands', () => {
  it('is a usage error (2) on a positional argument, before any request', async () => {
    const create = await probara(['run', 'create', 'nightly']);
    const close = await probara(['run', 'close', '--run-ulid', fake.seedRun(), 'now']);

    expect(create.exitCode).toBe(2);
    expect(create.stderr).toContain(
      '[probara] Unexpected argument "nightly". Run "probara run create --help" for usage.',
    );
    expect(close.exitCode).toBe(2);
    expect(close.stderr).toContain(
      '[probara] Unexpected argument "now". Run "probara run close --help" for usage.',
    );
    expect(create.stdout + close.stdout).toBe('');
    expect(fake.requests).toHaveLength(0);
  });
});

describe('sharded CI: create, import from every shard, close', () => {
  it('reports every shard into one run and closes it once', async () => {
    const created = await probara(['run', 'create', '--run-name', 'Sharded']);
    const ulid = created.stdout.trim();
    const shardEnv = configuredEnv(fake.baseUrl, { PROBARA_RUN_ULID: ulid });

    const shards = [
      await probara(['import', 'junit', 'jest/junit.xml'], shardEnv),
      await probara(['import', 'junit', 'pytest/junit.xml'], shardEnv),
    ];
    const closed = await probara(['run', 'close'], shardEnv);

    expect(shards.map((shard) => shard.exitCode)).toEqual([0, 0]);
    expect(fake.reports().map((report) => report.run)).toEqual([{ ulid }, { ulid }]);
    // A shard never closes a shared run.
    expect(fake.reports().map((report) => report.options?.close)).toEqual([false, false]);
    expect(closed.exitCode).toBe(0);
    expect(fake.runs()).toHaveLength(1);
    expect(fake.run(ulid)).toMatchObject({ name: 'Sharded', state: 'closed' });
    expect(fake.run(ulid)?.results).toHaveLength(23);
  });
});

describe('help of the run commands', () => {
  it('lists create and close under probara run --help, and in the root help', async () => {
    const group = await runCli(['run', '--help']);
    const root = await runCli(['--help']);

    expect(group.exitCode).toBe(0);
    expect(group.stdout).toMatch(/^ {2}create +Create a run/m);
    expect(group.stdout).toMatch(/^ {2}close +Close a run/m);
    expect(root.stdout).toMatch(/^ {2}run create +Create a run/m);
    expect(root.stdout).toMatch(/^ {2}run close +Close a run/m);
  });

  it.each(['run create', 'run close'] as const)(
    'documents every option of probara %s from the registry',
    async (command) => {
      const result = await runCli([...command.split(' '), '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Usage: probara ${command} [options]`);
      for (const option of optionsOf(command)) {
        expect(result.stdout).toContain(option.description);
        if (option.env !== undefined) expect(result.stdout).toContain(`env: ${option.env}`);
      }
    },
  );

  it('gives each command only its own options', () => {
    const create = optionsOf('run create').map((option) => option.name);
    const close = optionsOf('run close').map((option) => option.name);

    expect(create).toContain('run-name');
    expect(create).not.toContain('run-ulid');
    expect(close).toEqual([
      'project',
      'base-url',
      'run-ulid',
      'timeout',
      'max-retries',
      'json',
      'debug',
      'help',
    ]);
  });

  it('is a usage error (2) on an unknown run command', async () => {
    const result = await runCli(['run', 'delete']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unknown command "run delete". Run "probara run --help"');
  });
});
