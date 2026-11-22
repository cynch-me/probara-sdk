import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProbara, type FakeProbara } from '@probara/test-support/fake-probara';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { optionsOf } from '../src/options.js';
import { configuredEnv, runCli, TOKEN, type CliRun } from './support/run-cli.js';

const COMMIT = 'a'.repeat(40);
const RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2X9';

/** Outside any git checkout, so no build reads the parent commits of this repository. */
const workspace = mkdtempSync(join(tmpdir(), 'probara-cli-snap-upload-'));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** A PNG signature and a byte that makes each file another one. */
function png(seed: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}

function writeFiles(dir: string, files: Record<string, Uint8Array | string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(workspace, dir, path, '..'), { recursive: true });
    writeFileSync(join(workspace, dir, path), content);
  }
}

writeFiles('stories', {
  'checkout/cart.png': png(1),
  'button/primary.png': png(2),
  'home.png': png(3),
  'notes.txt': 'not a screenshot',
  'button/primary.png.json': '{}',
});
writeFiles('empty', { 'readme.md': 'no screenshot here' });

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return configuredEnv(fake.baseUrl, {
    PROBARA_COMMIT: COMMIT,
    PROBARA_BRANCH: 'feat/cart',
    ...extra,
  });
}

async function probara(args: readonly string[], variables = env()): Promise<CliRun> {
  const run = await runCli(args, { env: variables, cwd: workspace });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

function created(): Record<string, unknown>[] {
  return fake.requestsTo('snapCreateBuild').map(({ body }) => body as Record<string, unknown>);
}

describe('probara snap upload', () => {
  it('sends every .png under the directory, named by its path without .png, sorted', async () => {
    const result = await probara(['snap', 'upload', 'stories']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const [build] = fake.snapBuilds();
    expect(result.stderr).toContain(
      `[probara] Sent 3 screenshots to the Snap build #1 (3 new files): ${fake.baseUrl}/projects/PRB/snap/${build?.ulid ?? ''}`,
    );
    expect(build?.screenshots.map((screenshot) => screenshot['name'])).toEqual([
      'button/primary',
      'checkout/cart',
      'home',
    ]);
    expect(created()).toMatchObject([{ commit: COMMIT, branch: 'feat/cart' }]);
    expect(created()[0]).not.toHaveProperty('ciNonce');
  });

  it('gives every screenshot the browser, the viewport and the color mode of the flags', async () => {
    const result = await probara([
      'snap',
      'upload',
      'stories/checkout',
      '--browser',
      'chromium',
      '--viewport',
      '1280x720',
      '--color-mode',
      'dark',
    ]);

    expect(result.exitCode).toBe(0);
    expect(fake.snapBuilds()[0]?.screenshots).toMatchObject([
      {
        name: 'cart',
        browser: 'chromium',
        viewport: { width: 1280, height: 720 },
        colorMode: 'dark',
      },
    ]);
  });

  it('sends the build options: its name, a shard and its nonce, a split run, the run', async () => {
    fake.seedRun({ ulid: RUN });
    const sharded = await probara([
      'snap',
      'upload',
      'stories',
      '--build-name',
      'storybook',
      '--nonce',
      'pipeline-7',
      '--shard',
      '2/3',
      '--run-ulid',
      RUN,
    ]);
    const split = await probara(
      ['snap', 'upload', 'stories', '--parallel'],
      env({ GITLAB_CI: 'true', CI_PIPELINE_ID: '4521' }),
    );
    const fromEnv = await probara(
      ['snap', 'upload', 'stories'],
      env({ PROBARA_SNAP_BUILD_NAME: 'docs', PROBARA_RUN_ULID: RUN }),
    );

    expect([sharded.exitCode, split.exitCode, fromEnv.exitCode]).toEqual([0, 0, 0]);
    expect(created()).toMatchObject([
      { name: 'storybook', ciNonce: 'pipeline-7', shard: { index: 1, total: 3 }, runUlid: RUN },
      { ciNonce: '4521' },
      { name: 'docs', runUlid: RUN },
    ]);
    expect(created()[1]).not.toHaveProperty('shard');
  });

  it('prints the summary as JSON with --json', async () => {
    const result = await probara(['snap', 'upload', 'stories/checkout', '--json']);

    expect(JSON.parse(result.stdout)).toEqual({
      status: 'uploaded',
      build: {
        ulid: fake.snapBuilds()[0]?.ulid,
        number: 1,
        url: `${fake.baseUrl}/projects/PRB/snap/${fake.snapBuilds()[0]?.ulid ?? ''}`,
        jobStatus: 'progress',
      },
      screenshots: 1,
      files: 1,
    });
  });

  it('exits 1 with what Probara says when it refuses the build', async () => {
    fake.fail('snapCreateBuild', {
      status: 409,
      body: {
        error: { code: 'snap_screenshot_limit_reached', message: 'monthly screenshots used up' },
      },
    });

    const result = await probara(['snap', 'upload', 'stories']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[probara] Could not send the Snap screenshots: ');
    expect(result.stderr).toContain('monthly screenshots used up');
  });

  it('is a usage error (2) without a directory, with a missing or empty one, two of them or a wrong flag value: nothing is sent', async () => {
    const runs = {
      none: await probara(['snap', 'upload']),
      missing: await probara(['snap', 'upload', 'nowhere']),
      empty: await probara(['snap', 'upload', 'empty']),
      file: await probara(['snap', 'upload', 'stories/home.png']),
      two: await probara(['snap', 'upload', 'stories', 'empty']),
      viewport: await probara(['snap', 'upload', 'stories', '--viewport', '1280']),
      shard: await probara(['snap', 'upload', 'stories', '--shard', '3/2']),
      colorMode: await probara(['snap', 'upload', 'stories', '--color-mode', 'dim']),
      disabled: await probara(['snap', 'upload', 'empty'], env({ PROBARA_ENABLED: 'false' })),
    };

    expect(Object.values(runs).map((run) => run.exitCode)).toEqual(Array(9).fill(2));
    expect(runs.none.stderr).toContain(
      '[probara] The directory of the screenshots is missing. Run "probara snap upload --help" for usage.',
    );
    expect(runs.missing.stderr).toContain('[probara] nowhere is not a directory');
    expect(runs.empty.stderr).toContain('[probara] empty holds no .png file');
    expect(runs.file.stderr).toContain('[probara] stories/home.png is not a directory');
    expect(runs.two.stderr).toContain('[probara] Unexpected argument "empty"');
    expect(runs.viewport.stderr).toContain(
      '[probara] --viewport takes <width>x<height> in pixels, such as 1280x720',
    );
    expect(runs.shard.stderr).toContain(
      '[probara] --shard takes <index>/<total>, from 1, such as 2/3',
    );
    expect(runs.colorMode.stderr).toContain('[probara] --color-mode must be one of light, dark');
    expect(fake.requests).toEqual([]);
  });

  it('is a usage error (2) without a full commit or a branch: nothing is sent', async () => {
    const noCommit = await probara(
      ['snap', 'upload', 'stories'],
      env({ PROBARA_COMMIT: undefined }),
    );
    const shortCommit = await probara(
      ['snap', 'upload', 'stories'],
      env({ PROBARA_COMMIT: 'abc123' }),
    );
    const noBranch = await probara(
      ['snap', 'upload', 'stories'],
      env({ PROBARA_BRANCH: undefined }),
    );

    expect([noCommit.exitCode, shortCommit.exitCode, noBranch.exitCode]).toEqual([2, 2, 2]);
    expect(noCommit.stderr).toContain(
      '[probara] The commit is not known: set PROBARA_COMMIT to the full 40-character SHA of the commit the screenshots are of',
    );
    expect(shortCommit.stderr).toContain(
      '[probara] The commit is not known: set PROBARA_COMMIT to the full 40-character SHA',
    );
    expect(noBranch.stderr).toContain(
      '[probara] The branch is not known: set PROBARA_BRANCH to the branch the screenshots are of',
    );
    expect(fake.requests).toEqual([]);
  });

  it('exits 1 for a .png file that is not a PNG: nothing is sent', async () => {
    writeFiles('broken', { 'home.png': 'not a PNG' });

    const result = await probara(['snap', 'upload', 'broken']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      '[probara] Could not send the Snap screenshots: the screenshot "home" is not a PNG',
    );
    expect(fake.requests).toEqual([]);
  });

  it('reads the directory but sends nothing and exits 0 while reporting is off', async () => {
    const result = await probara(
      ['snap', 'upload', 'stories', '--json'],
      env({ PROBARA_ENABLED: 'false' }),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: 'disabled' });
    expect(result.stderr).toContain('no screenshot was sent');
    expect(fake.requests).toEqual([]);
  });

  it('documents its options from the registry', async () => {
    const result = await runCli(['snap', 'upload', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: probara snap upload [options] <dir>');
    expect(optionsOf('snap upload').map((option) => option.name)).toEqual([
      'project',
      'base-url',
      'build-name',
      'nonce',
      'shard',
      'parallel',
      'browser',
      'viewport',
      'color-mode',
      'run-ulid',
      'timeout',
      'max-retries',
      'json',
      'debug',
      'help',
    ]);
    expect(result.stdout).toMatch(/^ {2}--timeout <ms> +/m);
  });
});
