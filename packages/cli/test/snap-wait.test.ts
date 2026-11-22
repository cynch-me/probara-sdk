import { uploadSnapScreenshots } from '@probara/core';
import {
  startFakeProbara,
  type FakeProbara,
  type FakeSnapConclusion,
} from '@probara/test-support/fake-probara';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { optionsOf } from '../src/options.js';
import {
  configuredEnv,
  runCli,
  TOKEN,
  type CliRun,
  type RunCliOptions,
} from './support/run-cli.js';

const COMMIT = 'a'.repeat(40);
const COUNTS = { unchanged: 3 };

let fake: FakeProbara;

beforeEach(async () => {
  fake = await startFakeProbara({ token: TOKEN });
});

afterEach(async () => {
  await fake.close();
});

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return configuredEnv(fake.baseUrl, extra);
}

async function probara(
  args: readonly string[],
  variables = env(),
  options: RunCliOptions = {},
): Promise<CliRun> {
  const run = await runCli(args, { env: variables, ...options });
  expect(run.stdout).not.toContain(TOKEN);
  expect(run.stderr).not.toContain(TOKEN);
  return run;
}

/** Sends one screenshot as a build of `COMMIT`, with a nonce when given, and answers its ULID. */
async function sendBuild(options: { nonce?: string; buildName?: string } = {}): Promise<string> {
  const silent = () => undefined;
  const summary = await uploadSnapScreenshots({
    env: env({ PROBARA_COMMIT: COMMIT, PROBARA_BRANCH: 'feat/cart' }),
    logger: { debug: silent, info: silent, warn: silent, error: silent },
    screenshots: [
      { name: 'home', body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    ],
    ...(options.nonce === undefined ? {} : { nonce: options.nonce, shard: { index: 0, total: 1 } }),
    ...(options.buildName === undefined ? {} : { buildName: options.buildName }),
  });
  expect(summary.status).toBe('uploaded');
  return summary.build?.ulid ?? '';
}

const NO_CHANGES: FakeSnapConclusion = {
  jobStatus: 'complete',
  conclusion: 'no-changes',
  diffCounts: COUNTS,
};
const CHANGES: FakeSnapConclusion = {
  jobStatus: 'complete',
  conclusion: 'changes-detected',
  diffCounts: { unchanged: 1, changed: 2, added: 1 },
};

function listQueries(): string[] {
  return fake.requestsTo('snapListBuilds').map(({ search }) => search ?? '');
}

/** A clock that moves one second each time it is read. */
function ticking(): () => Date {
  let at = Date.parse('2026-11-22T10:00:00Z');
  return () => {
    at += 1000;
    return new Date(at);
  };
}

describe('probara snap wait', () => {
  it('reads the build of --build until it is complete, and exits 0', async () => {
    const ulid = await sendBuild();
    let reads = 0;
    const concluding: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      if (url.endsWith(`/snap/builds/${ulid}`) && (reads += 1) === 2) {
        fake.concludeSnapBuild(ulid, NO_CHANGES);
      }
      return response;
    };

    const result = await probara(['snap', 'wait', '--build', ulid], env(), { fetch: concluding });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const url = `${fake.baseUrl}/projects/PRB/snap/${ulid}`;
    expect(result.stderr).toContain(`[probara] Waiting for the Snap build #1: ${url}`);
    expect(result.stderr).toContain(
      `[probara] The Snap build #1 is complete: no visual changes: ${url}`,
    );
    expect(fake.requestsTo('snapGetBuild')).toHaveLength(3);
  });

  it('finds the build by its name and the nonce, from the flags or their variables', async () => {
    const ulid = await sendBuild({ nonce: 'nightly-7', buildName: 'mobile' });
    fake.concludeSnapBuild(ulid, NO_CHANGES);

    const fromFlags = await probara([
      'snap',
      'wait',
      '--nonce',
      'nightly-7',
      '--build-name',
      'mobile',
    ]);
    const fromEnv = await probara(
      ['snap', 'wait'],
      env({ PROBARA_SNAP_NONCE: 'nightly-7', PROBARA_SNAP_BUILD_NAME: 'mobile' }),
    );

    expect(fromFlags.exitCode).toBe(0);
    expect(fromEnv.exitCode).toBe(0);
    expect(listQueries()).toEqual([
      '?name=mobile&ciNonce=nightly-7&limit=1',
      '?name=mobile&ciNonce=nightly-7&limit=1',
    ]);
  });

  it('finds a build sent without a nonce by the commit of the CI, after the nonce of the CI', async () => {
    const ulid = await sendBuild();
    fake.concludeSnapBuild(ulid, NO_CHANGES);

    const result = await probara(
      ['snap', 'wait'],
      env({ GITHUB_ACTIONS: 'true', GITHUB_SHA: COMMIT, GITHUB_RUN_ID: '9876' }),
    );

    expect(result.exitCode).toBe(0);
    expect(listQueries()).toEqual([
      '?name=default&ciNonce=9876-1&limit=1',
      `?name=default&commit=${COMMIT}&limit=1`,
    ]);
  });

  it('prints the build as JSON with --json', async () => {
    const ulid = await sendBuild();
    fake.concludeSnapBuild(ulid, NO_CHANGES);

    const result = await probara(['snap', 'wait', '--build', ulid, '--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ulid,
      number: 1,
      jobStatus: 'complete',
      conclusion: 'no-changes',
      reviewStatus: null,
      url: `${fake.baseUrl}/projects/PRB/snap/${ulid}`,
    });
  });

  it('exits 0 with changes, and 4 with --fail-on-changes until their review accepts them', async () => {
    const ulid = await sendBuild();
    const wait = (...flags: string[]) => probara(['snap', 'wait', '--build', ulid, ...flags]);

    fake.concludeSnapBuild(ulid, { ...CHANGES, reviewStatus: null });
    const unflagged = await wait();
    const unreviewed = await wait('--fail-on-changes');
    fake.concludeSnapBuild(ulid, { ...CHANGES, reviewStatus: 'rejected' });
    const rejected = await wait('--fail-on-changes');
    fake.concludeSnapBuild(ulid, { ...CHANGES, reviewStatus: 'accepted' });
    const accepted = await wait('--fail-on-changes');

    expect(unflagged.exitCode).toBe(0);
    expect(unreviewed.exitCode).toBe(4);
    expect(unreviewed.stderr).toContain(
      'is complete: 2 changed, 1 added, 0 removed, waiting for review',
    );
    expect(rejected.exitCode).toBe(4);
    expect(rejected.stderr).toContain('is complete: changes rejected');
    expect(accepted.exitCode).toBe(0);
    expect(accepted.stderr).toContain('is complete: changes accepted');
  });

  it('exits 1 for a build that ended with an error or expired', async () => {
    const failed = await sendBuild();
    const expired = await sendBuild();
    fake.concludeSnapBuild(failed, { jobStatus: 'error', errorCode: 'diff_failed' });
    fake.concludeSnapBuild(expired, { jobStatus: 'expired' });

    const error = await probara(['snap', 'wait', '--build', failed, '--json']);
    const gone = await probara(['snap', 'wait', '--build', expired]);

    expect(error.exitCode).toBe(1);
    expect(error.stderr).toContain('[probara] The Snap build #1 ended with an error (diff_failed)');
    expect(JSON.parse(error.stdout)).toMatchObject({ ulid: failed, jobStatus: 'error' });
    expect(gone.exitCode).toBe(1);
    expect(gone.stderr).toContain(
      '[probara] The Snap build #2 expired before every screenshot arrived',
    );
  });

  it('exits 1 once --max-wait seconds pass, 15 minutes by default', async () => {
    const ulid = await sendBuild();

    const short = await probara(['snap', 'wait', '--build', ulid, '--max-wait', '12'], env(), {
      now: ticking(),
    });
    const long = await probara(['snap', 'wait', '--build', ulid], env(), { now: ticking() });

    expect(short.exitCode).toBe(1);
    expect(short.stderr).toContain(
      '[probara] Gave up waiting for the Snap build #1 after 12 seconds: it is still progress',
    );
    expect(long.exitCode).toBe(1);
    expect(long.stderr).toContain('after 15 minutes: it is still progress');
  });

  it('exits 1 without waiting when no build matches, or Probara does not know the build', async () => {
    const byNonce = await probara(['snap', 'wait', '--nonce', 'nightly-7']);
    const byUlid = await probara(['snap', 'wait', '--build', '01J9Z3K4M5N6P7Q8R9S0T1V2B1']);

    expect(byNonce.exitCode).toBe(1);
    expect(byNonce.stderr).toContain(
      '[probara] Could not wait for the Snap build: no Snap build named "default" has the nonce "nightly-7"',
    );
    expect(byUlid.exitCode).toBe(1);
    expect(byUlid.stderr).toContain('[probara] Could not wait for the Snap build: ');
    expect(fake.requestsTo('snapGetBuild')).toHaveLength(1);
  });

  it('is a usage error (2) when nothing names the build, on a --build that is no ULID, an argument or an unknown option: nothing is sent', async () => {
    const nothing = await probara(['snap', 'wait']);
    const notUlid = await probara(['snap', 'wait', '--build', 'B-1']);
    const argument = await probara(['snap', 'wait', 'now', '--nonce', 'pipeline-7']);
    const unknown = await probara(['snap', 'wait', '--nonce', 'pipeline-7', '--shard', '1/2']);

    expect(nothing.exitCode).toBe(2);
    expect(nothing.stderr).toContain(
      '[probara] The build is not known: pass --build or --nonce, or set PROBARA_COMMIT to the commit it is of (this CI names neither a nonce nor a commit)',
    );
    expect(notUlid.exitCode).toBe(2);
    expect(notUlid.stderr).toContain('[probara] --build must be the ULID of a build');
    expect(argument.exitCode).toBe(2);
    expect(argument.stderr).toContain(
      '[probara] Unexpected argument "now". Run "probara snap wait --help" for usage.',
    );
    expect(unknown.exitCode).toBe(2);
    expect(fake.requests).toEqual([]);
  });

  it('sends nothing and exits 0 while reporting is off', async () => {
    const result = await probara(
      ['snap', 'wait', '--nonce', 'pipeline-7', '--json'],
      env({ PROBARA_ENABLED: 'false' }),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: 'disabled' });
    expect(fake.requests).toEqual([]);
  });

  it('bounds one HTTP attempt with --timeout in milliseconds, as every command does', async () => {
    const ulid = await sendBuild();
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const started = Date.now();

    const result = await probara(
      ['snap', 'wait', '--build', ulid, '--timeout', '50', '--max-retries', '0'],
      env(),
      { fetch: hanging },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[probara] Could not wait for the Snap build: ');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('documents its options from the registry, --max-wait in seconds, --timeout in milliseconds, and exit code 4', async () => {
    const result = await runCli(['snap', 'wait', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: probara snap wait [options]');
    expect(optionsOf('snap wait').map((option) => option.name)).toEqual([
      'project',
      'base-url',
      'build-name',
      'nonce',
      'build',
      'max-wait',
      'fail-on-changes',
      'timeout',
      'max-retries',
      'json',
      'debug',
      'help',
    ]);
    expect(result.stdout).toMatch(/^ {2}--max-wait <seconds> +/m);
    expect(result.stdout).toMatch(/^ {2}--timeout <ms> +Timeout of one HTTP attempt/m);
    expect(result.stdout).toMatch(/^ {2}4 +The build has changes its review did not accept/m);
  });
});
