import { uploadSnapScreenshots } from '@probara/core';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { optionsOf } from '../src/options.js';
import { configuredEnv, runCli, TOKEN, type CliRun } from './support/run-cli.js';

const COMMIT = 'a'.repeat(40);
const BUILDS = '/api/v1/projects/PRB/snap/builds';

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

function env(extra: Record<string, string> = {}): Record<string, string | undefined> {
  return configuredEnv(fake.baseUrl, extra);
}

async function probara(args: readonly string[], variables = env()): Promise<CliRun> {
  const run = await runCli(args, { env: variables });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

/** A PNG signature and a byte that makes each file another one. */
function png(seed: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}

/** What one machine of a split run sends: its screenshots, joined to the build of the nonce. */
async function machine(
  nonce: string,
  screenshots: readonly { name: string; body: Uint8Array }[],
  buildName?: string,
): Promise<void> {
  const silent = () => undefined;
  const summary = await uploadSnapScreenshots({
    env: env({ PROBARA_COMMIT: COMMIT, PROBARA_BRANCH: 'feat/cart' }),
    logger: { debug: silent, info: silent, warn: silent, error: silent },
    parallel: true,
    nonce,
    screenshots,
    ...(buildName === undefined ? {} : { buildName }),
  });
  expect(summary.status).toBe('uploaded');
}

async function post(path: string, body: unknown): Promise<void> {
  await fetch(`${fake.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

function sent(): unknown[] {
  return fake.requestsTo('snapFinalizeBuildByNonce').map(({ body }) => body);
}

describe('probara snap finalize', () => {
  it('finalizes the build the machines of a run joined by their nonce', async () => {
    await machine('pipeline-7', [{ name: 'home', body: png(1) }]);
    await machine('pipeline-7', [{ name: 'cart', body: png(2) }]);
    await machine('pipeline-7', []);
    expect(fake.snapBuilds().map((build) => build.jobStatus)).toEqual(['pending']);

    const result = await probara(['snap', 'finalize', '--nonce', 'pipeline-7']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      `[probara] Finalized the Snap build #1 (2 screenshots): ${fake.baseUrl}/projects/PRB/snap/builds/1`,
    );
    const [build] = fake.snapBuilds();
    expect(build?.jobStatus).toBe('progress');
    expect(build?.screenshots.map((screenshot) => screenshot['name'])).toEqual(['home', 'cart']);
    expect(sent()).toEqual([{ ciNonce: 'pipeline-7' }]);
  });

  it('takes the nonce and the build name from their variables, and the flags over them', async () => {
    await machine('nightly-7', [{ name: 'home', body: png(1) }], 'mobile');
    const variables = env({ PROBARA_SNAP_NONCE: 'nightly-7', PROBARA_SNAP_BUILD_NAME: 'mobile' });

    const fromEnv = await probara(['snap', 'finalize', '--json'], variables);
    const fromFlags = await probara(
      ['snap', 'finalize', '--nonce', 'nightly-7', '--build-name', 'mobile'],
      env({ PROBARA_SNAP_NONCE: 'other', PROBARA_SNAP_BUILD_NAME: 'desktop' }),
    );

    expect(fromEnv.exitCode).toBe(0);
    expect(JSON.parse(fromEnv.stdout)).toEqual({
      status: 'finalized',
      build: {
        ulid: fake.snapBuilds()[0]?.ulid,
        number: 1,
        url: `${fake.baseUrl}/projects/PRB/snap/builds/1`,
        jobStatus: 'progress',
      },
    });
    expect(fromFlags.exitCode).toBe(0);
    expect(sent()).toEqual([
      { name: 'mobile', ciNonce: 'nightly-7' },
      { name: 'mobile', ciNonce: 'nightly-7' },
    ]);
  });

  it('takes the nonce the CI gives, as the machines of the run did', async () => {
    await machine('4521', [{ name: 'home', body: png(1) }]);

    const result = await probara(
      ['snap', 'finalize'],
      env({ GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' }),
    );

    expect(result.exitCode).toBe(0);
    expect(sent()).toEqual([{ ciNonce: '4521' }]);
  });

  it('exits 1 with what Probara says when no build has the name and the nonce (404)', async () => {
    const result = await probara(['snap', 'finalize', '--nonce', 'pipeline-7', '--json']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[probara] Could not finalize the Snap build: ');
    expect(result.stderr).toContain('no snap build has this name and CI nonce');
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      error: { status: 404, code: 'not_found' },
    });
  });

  it('exits 1 with what Probara says while no machine finalized its screenshots (409)', async () => {
    await post(BUILDS, { commit: COMMIT, branch: 'main', ciNonce: 'pipeline-7', files: [] });

    const result = await probara(['snap', 'finalize', '--nonce', 'pipeline-7']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('finalize at least one shard before finalizing the build');
    expect(fake.snapBuilds()[0]?.jobStatus).toBe('pending');
  });

  it('exits 1 with what Probara says for a build its shard total completes (422)', async () => {
    await post(BUILDS, {
      commit: COMMIT,
      branch: 'main',
      ciNonce: 'pipeline-7',
      shard: { index: 0, total: 2 },
      files: [],
    });

    const result = await probara(['snap', 'finalize', '--nonce', 'pipeline-7']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('this build is finalized when its shards are finalized');
  });

  it('is a usage error (2) without a nonce, with an argument, an unknown option or no token: nothing is sent', async () => {
    const noNonce = await probara(['snap', 'finalize']);
    const argument = await probara(['snap', 'finalize', 'now', '--nonce', 'pipeline-7']);
    const unknown = await probara(['snap', 'finalize', '--nonce', 'pipeline-7', '--shard', '1']);
    const noToken = await probara(
      ['snap', 'finalize', '--nonce', 'pipeline-7'],
      env({ PROBARA_API_TOKEN: '' }),
    );

    expect(noNonce.exitCode).toBe(2);
    expect(noNonce.stderr).toContain(
      '[probara] The nonce is not set: pass --nonce or set PROBARA_SNAP_NONCE to the value the machines of the run sent (this CI names none)',
    );
    expect(argument.exitCode).toBe(2);
    expect(argument.stderr).toContain(
      '[probara] Unexpected argument "now". Run "probara snap finalize --help" for usage.',
    );
    expect(unknown.exitCode).toBe(2);
    expect(noToken.exitCode).toBe(2);
    expect(fake.requests).toEqual([]);
  });

  it('sends nothing and exits 0 while reporting is off', async () => {
    const result = await probara(
      ['snap', 'finalize', '--nonce', 'pipeline-7', '--json'],
      env({ PROBARA_ENABLED: 'false' }),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: 'disabled' });
    expect(result.stderr).toContain('no build was finalized');
    expect(fake.requests).toEqual([]);
  });
});

describe('help of the snap commands', () => {
  it('lists finalize under probara snap --help, and in the root help', async () => {
    const group = await runCli(['snap', '--help']);
    const root = await runCli(['--help']);
    const none = await runCli(['snap']);

    expect(group.exitCode).toBe(0);
    expect(group.stdout).toMatch(/^ {2}finalize +Finalize the Snap build/m);
    expect(root.stdout).toMatch(/^ {2}snap finalize +Finalize the Snap build/m);
    expect(none.exitCode).toBe(2);
    expect(none.stderr).toBe(group.stdout);
  });

  it('documents every option of probara snap finalize from the registry, and no other', async () => {
    const result = await runCli(['snap', 'finalize', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: probara snap finalize [options]');
    for (const option of optionsOf('snap finalize')) {
      expect(result.stdout).toContain(option.description);
      if (option.env !== undefined) expect(result.stdout).toContain(`env: ${option.env}`);
    }
    expect(optionsOf('snap finalize').map((option) => option.name)).toEqual([
      'project',
      'base-url',
      'build-name',
      'nonce',
      'timeout',
      'max-retries',
      'json',
      'debug',
      'help',
    ]);
  });

  it('is a usage error (2) on an unknown snap command', async () => {
    const result = await runCli(['snap', 'upload']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Unknown command "snap upload"');
  });
});
