import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { configuredEnv, runCli, TOKEN, type CliRun } from './support/run-cli.js';

const workspace = mkdtempSync(join(tmpdir(), 'probara-cli-releases-'));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const BASE_URL = 'https://probara.test';
const ENDPOINT = `${BASE_URL}/api/v1/projects/PRB/error-monitoring/release-commits`;

function git(cwd: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

/** A repository with three commits, each with its own author, time and files. */
function repository(name: string, origin: string | undefined) {
  const dir = join(workspace, name);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  if (origin !== undefined) git(dir, ['remote', 'add', 'origin', origin]);
  const commits = [
    { file: 'README.md', message: 'Initial commit', date: '2026-11-20T09:00:00+01:00' },
    {
      file: 'src/cart.ts',
      message: 'Empty carts no longer crash\n\nfixes ERR-7',
      date: '2026-11-21T10:30:00+01:00',
    },
    { file: 'src/checkout.ts', message: 'Show the total', date: '2026-11-22T11:45:00-03:00' },
  ].map(({ file, message, date }, index) => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, file), `content ${index}\n`);
    git(dir, ['add', '.']);
    git(dir, ['commit', '--quiet', '-m', message], {
      GIT_AUTHOR_NAME: `Author ${index}`,
      GIT_AUTHOR_EMAIL: `author${index}@example.com`,
      GIT_COMMITTER_NAME: `Author ${index}`,
      GIT_COMMITTER_EMAIL: `author${index}@example.com`,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    return { sha: git(dir, ['rev-parse', 'HEAD']), file, message, date, index };
  });
  return { dir, commits };
}

const ssh = repository('ssh', 'git@github.com:acme/shop.git');
const https = repository('https', 'https://github.com/acme/web-app.git');
const gitlab = repository('gitlab', 'git@gitlab.com:acme/shop.git');

interface Sent {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that answers `answers` in turn (the last one again once they run out). */
function fakeFetch(answers: readonly Answer[] = [created()]) {
  const sent: Sent[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown,
    });
    const answer = answers[Math.min(sent.length, answers.length) - 1] ?? created();
    return Promise.resolve(
      new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json', ...answer.headers },
      }),
    );
  };
  return { fetch, sent };
}

function created(
  items = 2,
  resolvedIssues: { ulid: string; displayId: string }[] = [
    { ulid: '01KC0000000000000000000E07', displayId: 'ERR-7' },
  ],
): Answer {
  return {
    status: 201,
    body: {
      release: 'shop@1.4.2',
      items: Array.from({ length: items }, (_, index) => ({
        sha: `${index}`.repeat(40),
        repository: 'acme/shop',
        message: 'm',
        authorName: null,
        authorEmail: null,
        authorLogin: null,
        committedAt: '2026-11-21T09:30:00.000Z',
        files: [],
      })),
      resolvedIssues,
    },
  };
}

async function setCommits(
  args: readonly string[],
  options: {
    cwd?: string;
    fetch?: typeof globalThis.fetch;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<CliRun> {
  const result = await runCli(['releases', 'set-commits', '--release', 'shop@1.4.2', ...args], {
    cwd: options.cwd ?? ssh.dir,
    env: options.env ?? configuredEnv(BASE_URL),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  expect(result.stdout + result.stderr).not.toContain(TOKEN);
  return result;
}

describe('probara releases set-commits --auto', () => {
  it('sends the HEAD of the GitHub repository of an ssh origin as the head of the release', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--auto'], { fetch });

    expect(result.exitCode).toBe(0);
    expect(sent).toEqual([
      {
        url: ENDPOINT,
        method: 'POST',
        authorization: `Bearer ${TOKEN}`,
        body: {
          release: 'shop@1.4.2',
          refs: [{ repository: 'acme/shop', commit: ssh.commits[2]?.sha }],
        },
      },
    ]);
    expect(result.stderr).toContain('[probara] Recorded 2 commits for release shop@1.4.2');
    expect(result.stderr).toContain('[probara] Resolved ERR-7');
  });

  it('reads the repository of an https origin', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--auto'], { cwd: https.dir, fetch });

    expect(result.exitCode).toBe(0);
    expect(sent[0]?.body).toEqual({
      release: 'shop@1.4.2',
      refs: [{ repository: 'acme/web-app', commit: https.commits[2]?.sha }],
    });
  });

  it('refuses an origin that is not on GitHub, and sends nothing', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--auto'], { cwd: gitlab.dir, fetch });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('is not a GitHub repository');
    expect(sent).toEqual([]);
  });
});

describe('probara releases set-commits --commit', () => {
  it('sends each repository with its commit, and the previous commit of a range', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(
      ['--commit', 'acme/shop@abc1234', '--commit', 'acme/api@1111111..2222222'],
      { fetch, cwd: workspace },
    );

    expect(result.exitCode).toBe(0);
    expect(sent[0]?.body).toEqual({
      release: 'shop@1.4.2',
      refs: [
        { repository: 'acme/shop', commit: 'abc1234' },
        { repository: 'acme/api', commit: '2222222', previousCommit: '1111111' },
      ],
    });
  });

  it('is a usage error for a value that is not <owner/name>@<sha>', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--commit', 'abc1234'], { fetch });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--commit takes <owner/name>@<sha>');
    expect(sent).toEqual([]);
  });
});

describe('probara releases set-commits --local', () => {
  it('sends the commits after --previous-commit with their author, time and files', async () => {
    const { fetch, sent } = fakeFetch();
    const [first, second, third] = ssh.commits;

    const result = await setCommits(['--local', '--previous-commit', first?.sha ?? ''], { fetch });

    expect(result.exitCode).toBe(0);
    expect(sent[0]?.body).toEqual({
      release: 'shop@1.4.2',
      commits: [
        {
          sha: third?.sha,
          repository: 'acme/shop',
          message: 'Show the total',
          authorName: 'Author 2',
          authorEmail: 'author2@example.com',
          timestamp: '2026-11-22T11:45:00-03:00',
          files: ['src/checkout.ts'],
        },
        {
          sha: second?.sha,
          repository: 'acme/shop',
          message: 'Empty carts no longer crash\n\nfixes ERR-7',
          authorName: 'Author 1',
          authorEmail: 'author1@example.com',
          timestamp: '2026-11-21T10:30:00+01:00',
          files: ['src/cart.ts'],
        },
      ],
    });
  });

  it('sends the last --initial-depth commits without a previous commit', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--local', '--initial-depth', '1'], { fetch });

    expect(result.exitCode).toBe(0);
    const body = sent[0]?.body as { commits: { sha: string }[] };
    expect(body.commits.map(({ sha }) => sha)).toEqual([ssh.commits[2]?.sha]);
  });

  it('sends every commit of the repository when it has fewer than the default depth', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--local'], { fetch });

    expect(result.exitCode).toBe(0);
    const body = sent[0]?.body as { commits: { sha: string }[] };
    expect(body.commits.map(({ sha }) => sha)).toEqual(
      [...ssh.commits].reverse().map(({ sha }) => sha),
    );
  });

  it('is a usage error for an --initial-depth over 100', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--local', '--initial-depth', '101'], { fetch });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--initial-depth must be 1 to 100');
    expect(sent).toEqual([]);
  });
});

describe('probara releases set-commits usage', () => {
  it.each([
    ['no mode', []],
    ['two modes', ['--auto', '--local']],
    ['--auto and --commit', ['--auto', '--commit', 'acme/shop@abc1234']],
  ])('is a usage error with %s, and sends nothing', async (_name, args) => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(args, { fetch });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('exactly one of --auto, --commit and --local');
    expect(sent).toEqual([]);
  });

  it('is a usage error without --release', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await runCli(['releases', 'set-commits', '--auto'], {
      cwd: ssh.dir,
      env: configuredEnv(BASE_URL),
      fetch,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--release is required');
    expect(sent).toEqual([]);
  });

  it('is a usage error with more than 10 --commit', async () => {
    const { fetch, sent } = fakeFetch();
    const commits = Array.from({ length: 11 }, (_, index) => [
      '--commit',
      `acme/repo${index}@abc1234`,
    ]).flat();

    const result = await setCommits(commits, { fetch });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('at most 10 --commit');
    expect(sent).toEqual([]);
  });
});

describe('probara releases set-commits answers', () => {
  it('fails (1) with the code Probara refuses the commits with', async () => {
    const { fetch, sent } = fakeFetch([
      {
        status: 422,
        body: {
          error: {
            code: 'github_repository_not_linked',
            message: 'acme/shop is not linked to the project',
          },
        },
      },
    ]);

    const result = await setCommits(['--auto'], { fetch });

    expect(result.exitCode).toBe(1);
    expect(sent).toHaveLength(1);
    expect(result.stderr).toContain(
      'Probara answered 422 github_repository_not_linked: acme/shop is not linked to the project',
    );
  });

  it('retries a 503, then reports what the next attempt recorded', async () => {
    const { fetch, sent } = fakeFetch([
      { status: 503, body: { error: { code: 'github_unavailable', message: 'down' } } },
      created(1, []),
    ]);

    const result = await setCommits(['--auto'], { fetch });

    expect(result.exitCode).toBe(0);
    expect(sent).toHaveLength(2);
    expect(result.stderr).toContain('attempt 1 of 5, got 503; retrying in 1000 ms');
    expect(result.stderr).toContain('[probara] Recorded 1 commit for release shop@1.4.2');
    expect(result.stderr).not.toContain('Resolved');
  });

  it('prints the answer as JSON with --json', async () => {
    const { fetch } = fakeFetch();

    const result = await setCommits(['--auto', '--json'], { fetch });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'recorded',
      release: 'shop@1.4.2',
      resolvedIssues: [{ displayId: 'ERR-7' }],
    });
  });
});

describe('probara releases set-commits --dry-run', () => {
  it('prints the body and sends nothing, without a token', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--auto', '--dry-run'], { fetch, env: {} });

    expect(result.exitCode).toBe(0);
    expect(sent).toEqual([]);
    expect(JSON.parse(result.stdout)).toEqual({
      release: 'shop@1.4.2',
      refs: [{ repository: 'acme/shop', commit: ssh.commits[2]?.sha }],
    });
    expect(result.stderr).toContain('nothing was sent');
  });

  it('sends nothing when reporting is disabled', async () => {
    const { fetch, sent } = fakeFetch();

    const result = await setCommits(['--auto'], {
      fetch,
      env: configuredEnv(BASE_URL, { PROBARA_ENABLED: 'false' }),
    });

    expect(result.exitCode).toBe(0);
    expect(sent).toEqual([]);
  });
});
