import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Logger } from './logger.js';
import { runGit, snapParentCommits, type GitRunner } from './snap-git.js';

const scratch = mkdtempSync(join(tmpdir(), 'probara-core-snap-git-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Probara',
  GIT_AUTHOR_EMAIL: 'snap@probara.test',
  GIT_COMMITTER_NAME: 'Probara',
  GIT_COMMITTER_EMAIL: 'snap@probara.test',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A runner around the real git that records every argument list it is given. */
function recording(inner: GitRunner = runGit) {
  const calls: string[][] = [];
  const runner: GitRunner = (args, cwd) => {
    calls.push([...args]);
    return inner(args, cwd);
  };
  return { runner, calls };
}

/**
 * Appends `count` commits to `branch` (from `from`, else a new root) in one fast-import, and
 * returns their SHAs, oldest first.
 */
function commits(repo: string, branch: string, count: number, from?: string): string[] {
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const content = `${branch} ${index}\n`;
    lines.push(
      `commit refs/heads/${branch}`,
      `mark :${index + 1}`,
      `committer Probara <snap@probara.test> ${1_700_000_000 + index} +0000`,
      `data ${Buffer.byteLength(`${branch} ${index}`)}`,
      `${branch} ${index}`,
    );
    if (index === 0 && from !== undefined) lines.push(`from ${from}`);
    if (index > 0) lines.push(`from :${index}`);
    lines.push(`M 644 inline file.txt`, `data ${Buffer.byteLength(content)}`, content);
  }
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd: repo,
    env: GIT_ENV,
    input: `${lines.join('\n')}\n`,
  });
  return git(repo, 'rev-list', '--reverse', `refs/heads/${branch}`).split('\n').slice(-count);
}

let origin = '';
let main: string[] = [];
let feature: string[] = [];
let orphan: string[] = [];

/** A clone of the origin: shallow (`--depth 1`) unless `full`. */
function cloneOf(name: string, branch: string, full = false): string {
  const dir = join(scratch, name);
  execFileSync(
    'git',
    [
      'clone',
      '--quiet',
      ...(full ? [] : ['--depth', '1']),
      '--branch',
      branch,
      `file://${origin}`,
      dir,
    ],
    { env: GIT_ENV },
  );
  return dir;
}

beforeAll(() => {
  origin = join(scratch, 'origin.git');
  git(scratch, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  main = commits(origin, 'main', 320);
  feature = commits(origin, 'feature', 250, main[305]);
  orphan = commits(origin, 'unrelated', 3);
}, 60_000);

describe('snapParentCommits', () => {
  it('starts at the merge base of the head and its base branch, deepening a shallow clone, at most 300', async () => {
    const clone = cloneOf('pull-request', 'feature');
    const parents = await snapParentCommits({
      cwd: clone,
      commit: feature.at(-1) as string,
      branch: 'feature',
      baseBranch: 'main',
      git: recording().runner,
      logger: silent,
    });
    expect(parents?.[0]).toBe(main[305]);
    expect(parents?.[1]).toBe(main[304]);
    expect(parents).toHaveLength(300);
  });

  it('starts at the merge base from the merge commit checkout of a pull request, which lacks the head', async () => {
    const clone = cloneOf('merge-checkout', 'main');
    const parents = await snapParentCommits({
      cwd: clone,
      commit: feature.at(-1) as string,
      branch: 'feature',
      baseBranch: 'main',
      git: recording().runner,
      logger: silent,
    });
    expect(parents?.slice(0, 2)).toEqual([main[305], main[304]]);
  });

  it('fetches nothing for a commit the checkout does not hold', async () => {
    const clone = cloneOf('unknown-commit', 'main');
    const { runner, calls } = recording();
    await expect(
      snapParentCommits({
        cwd: clone,
        commit: 'f'.repeat(40),
        branch: 'main',
        git: runner,
        logger: silent,
      }),
    ).resolves.toBeUndefined();
    expect(calls.filter((args) => args[0] === 'fetch')).toEqual([]);
  });

  it('starts at the merge base in a full clone too, and leaves the clone whole', async () => {
    const clone = cloneOf('full', 'feature', true);
    const parents = await snapParentCommits({
      cwd: clone,
      commit: feature.at(-1) as string,
      branch: 'feature',
      baseBranch: 'main',
      git: recording().runner,
      logger: silent,
    });
    expect(parents?.slice(0, 2)).toEqual([main[305], main[304]]);
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('false');
  });

  it('starts at the commit itself on a push without a base branch (the default branch)', async () => {
    const clone = cloneOf('push', 'main');
    const parents = await snapParentCommits({
      cwd: clone,
      commit: main.at(-1) as string,
      branch: 'main',
      git: recording().runner,
      logger: silent,
    });
    expect(parents?.slice(0, 3)).toEqual([main[319], main[318], main[317]]);
    expect(parents).toHaveLength(300);
  });

  it('starts at the head when the base branch is the branch itself', async () => {
    const clone = cloneOf('push-base', 'main');
    const parents = await snapParentCommits({
      cwd: clone,
      commit: main.at(-1) as string,
      branch: 'main',
      baseBranch: 'main',
      git: recording().runner,
      logger: silent,
    });
    expect(parents?.[0]).toBe(main[319]);
  });

  it('passes every branch and commit to git after --end-of-options', async () => {
    const clone = cloneOf('argv', 'feature');
    const { runner, calls } = recording();
    const head = feature.at(-1) as string;
    await snapParentCommits({
      cwd: clone,
      commit: head,
      branch: 'feature',
      baseBranch: 'main',
      git: runner,
      logger: silent,
    });
    const names = (arg: string) =>
      arg === 'main' ||
      arg.startsWith('feature') ||
      arg.startsWith('main:') ||
      /^[0-9a-f]{40}/.test(arg) ||
      arg.startsWith('refs/');
    const named = calls.filter((args) => args.some(names));
    expect(named.map((args) => args[0])).toEqual(
      expect.arrayContaining(['fetch', 'merge-base', 'log', 'rev-parse']),
    );
    for (const args of named) {
      const end = args.indexOf('--end-of-options');
      expect(end, args.join(' ')).toBeGreaterThanOrEqual(0);
      args.forEach((arg, index) => {
        if (names(arg)) expect(index, args.join(' ')).toBeGreaterThan(end);
      });
    }
  });

  it('never lets a branch named like an option reach git as one, and sends nothing for it', async () => {
    const clone = cloneOf('hostile', 'feature');
    const marker = join(scratch, 'pwned');
    const { runner, calls } = recording();
    const hostile = `--upload-pack=touch ${marker}`;
    const parents = await snapParentCommits({
      cwd: clone,
      commit: feature.at(-1) as string,
      branch: 'feature',
      baseBranch: hostile,
      git: runner,
      logger: silent,
    });
    expect(parents).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
    expect(calls.some((args) => args.some((arg) => arg.includes(hostile)))).toBe(false);
  });

  it('sends nothing when git is missing', async () => {
    const missing: GitRunner = () =>
      Promise.reject(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
    await expect(
      snapParentCommits({
        cwd: scratch,
        commit: main[0] as string,
        branch: 'main',
        git: missing,
        logger: silent,
      }),
    ).resolves.toBeUndefined();
  });

  it('sends nothing outside a git repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probara-core-snap-norepo-'));
    try {
      await expect(
        snapParentCommits({
          cwd: dir,
          commit: main[0] as string,
          branch: 'feature',
          baseBranch: 'main',
          git: recording().runner,
          logger: silent,
        }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends nothing when the base branch cannot be fetched nor found locally', async () => {
    const clone = cloneOf('offline', 'feature');
    git(clone, 'remote', 'set-url', 'origin', `file://${join(scratch, 'gone.git')}`);
    await expect(
      snapParentCommits({
        cwd: clone,
        commit: feature.at(-1) as string,
        branch: 'feature',
        baseBranch: 'main',
        git: recording().runner,
        logger: silent,
      }),
    ).resolves.toBeUndefined();
  });

  it('sends nothing when the head and its base branch share no history', async () => {
    const clone = cloneOf('unrelated', 'feature');
    await expect(
      snapParentCommits({
        cwd: clone,
        commit: feature.at(-1) as string,
        branch: 'feature',
        baseBranch: 'unrelated',
        git: recording().runner,
        logger: silent,
      }),
    ).resolves.toBeUndefined();
    expect(orphan).toHaveLength(3);
  });

  it('retries a fetch that meets a .git lock held by another git process', async () => {
    const clone = cloneOf('locked', 'feature');
    let locked = 1;
    const { runner, calls } = recording((args, cwd) => {
      if (args[0] === 'fetch' && locked > 0) {
        locked -= 1;
        return Promise.reject(
          Object.assign(new Error('Command failed: git fetch'), {
            stderr: `fatal: Unable to create '${clone}/.git/shallow.lock': File exists.`,
          }),
        );
      }
      return runGit(args, cwd);
    });
    const parents = await snapParentCommits({
      cwd: clone,
      commit: feature.at(-1) as string,
      branch: 'feature',
      baseBranch: 'main',
      git: runner,
      logger: silent,
      sleep: () => Promise.resolve(),
    });
    expect(parents?.[0]).toBe(main[305]);
    const fetches = calls.filter((args) => args[0] === 'fetch');
    expect(fetches[1]).toEqual(fetches[0]);
  });

  it('reads the history once per commit, branch and base branch', async () => {
    const clone = cloneOf('once', 'main');
    const { runner, calls } = recording();
    const input = {
      cwd: clone,
      commit: main.at(-1) as string,
      branch: 'main',
      git: runner,
      logger: silent,
    };
    const first = await snapParentCommits(input);
    const count = calls.length;
    await expect(snapParentCommits(input)).resolves.toEqual(first);
    expect(calls).toHaveLength(count);
  });
});
