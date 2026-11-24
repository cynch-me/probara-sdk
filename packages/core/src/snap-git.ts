/**
 * The commits Probara Snap picks the baseline build among: the merge base of the head commit and
 * its base branch, then its ancestors, closest first. Read from the local git history, deepened
 * from origin when the checkout is shallow, so Snap needs no link to the git provider. Node only.
 *
 * The branches come from the CI, where whoever opens a pull request names them. git is therefore
 * spawned without a shell, and every branch and commit is passed after `--end-of-options`, so a
 * branch named `--upload-pack=<command>` stays a ref and never becomes an option.
 */
import { execFile } from 'node:child_process';
import type { Logger } from './logger.js';
import { messageOf } from './runtime.js';

/** Runs git with `args` in `cwd` and resolves its stdout; rejects when git fails or is missing. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

export interface SnapParentCommitsInput {
  /** The git checkout. */
  cwd: string;
  /** The head commit of the build, a full SHA. */
  commit: string;
  /** The branch of the build. */
  branch: string;
  /** The branch a pull request targets. Without it, the list starts at `commit`. */
  baseBranch?: string | undefined;
  logger: Logger;
  /** Defaults to {@link runGit}. */
  git?: GitRunner | undefined;
  /** Waits before a fetch is retried. Defaults to `setTimeout`. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** At most this many commits are sent, as the API accepts. */
export const SNAP_PARENT_COMMITS_MAX = 300;
const FIRST_DEPTH = 200;
const LAST_DEPTH = 1000;
const DEPTH_STEP = 200;
const HEAD_REF = 'refs/probara/snap/head';
const BASE_REF = 'refs/probara/snap/base';
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const UNSAFE_BRANCH = /[\s:^~?*[\\]|\.\.|^[-+]/;
const LOCK_RETRIES = 3;
const LOCK_DELAY_MS = 500;
const GIT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** git from the PATH, without a shell, never prompting for credentials. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        const failure: Error = Object.assign(error, { stderr });
        reject(failure);
      },
    );
  });

interface Context {
  cwd: string;
  git: GitRunner;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
}

function outputOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  return `${messageOf(error)}\n${typeof stderr === 'string' ? stderr : ''}`.trim();
}

function isLockContention(error: unknown): boolean {
  const output = outputOf(error);
  return (
    output.includes(".lock': File exists") ||
    output.includes('Another git process seems to be running')
  );
}

/** Fetches `refs` from origin; retries while another git process holds a `.git/*.lock`. */
async function fetchFromOrigin(
  context: Context,
  options: readonly string[],
  refs: readonly string[],
): Promise<boolean> {
  const args = ['fetch', '--quiet', '--no-tags', ...options, '--end-of-options', 'origin', ...refs];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await context.git(args, context.cwd);
      return true;
    } catch (error) {
      if (isLockContention(error) && attempt < LOCK_RETRIES) {
        const delay = LOCK_DELAY_MS * 2 ** attempt;
        context.logger.debug(
          `git fetch met a lock held by another git process: retrying in ${delay} ms`,
        );
        await context.sleep(delay);
        continue;
      }
      context.logger.debug(`git fetch of ${refs.join(' ')} failed: ${outputOf(error)}`);
      return false;
    }
  }
}

/** The commit `ref` names in the local repository, else `undefined`. */
async function commitOf(context: Context, ref: string): Promise<string | undefined> {
  try {
    const sha = (
      await context.git(
        ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
        context.cwd,
      )
    ).trim();
    return FULL_COMMIT.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

async function firstCommitOf(
  context: Context,
  refs: readonly string[],
): Promise<string | undefined> {
  for (const ref of refs) {
    const sha = await commitOf(context, ref);
    if (sha !== undefined) return sha;
  }
  return undefined;
}

/**
 * The merge base of `commit` (else the fetched head branch) and the base branch. In a shallow
 * clone both branches are fetched deeper and deeper (200 commits, then 400... up to 1000) until
 * one is found; a branch origin does not give is read from the local history.
 */
async function mergeBaseOf(
  context: Context,
  input: { commit: string; branch: string; baseBranch: string },
  shallow: boolean,
): Promise<string | undefined> {
  const { commit, branch, baseBranch } = input;
  if (UNSAFE_BRANCH.test(branch) || UNSAFE_BRANCH.test(baseBranch)) {
    context.logger.debug('Snap reads no git history for a branch name git would refuse');
    return undefined;
  }
  const depths: (number | undefined)[] = [];
  if (shallow) {
    for (let depth = FIRST_DEPTH; depth <= LAST_DEPTH; depth += DEPTH_STEP) depths.push(depth);
  } else {
    depths.push(undefined);
  }
  let headFetched = false;
  let baseFetched = false;
  let headFetchable = true;
  let baseFetchable = true;
  for (const depth of depths) {
    const options = ['--force', ...(depth === undefined ? [] : ['--depth', String(depth)])];
    if (headFetchable) {
      headFetchable = await fetchFromOrigin(context, options, [`${branch}:${HEAD_REF}`]);
      headFetched ||= headFetchable;
    }
    if (baseFetchable) {
      baseFetchable = await fetchFromOrigin(context, options, [`${baseBranch}:${BASE_REF}`]);
      baseFetched ||= baseFetchable;
    }
    const head = await firstCommitOf(context, headFetched ? [commit, HEAD_REF] : [commit]);
    const base = await firstCommitOf(
      context,
      baseFetched ? [BASE_REF] : [`refs/remotes/origin/${baseBranch}`, baseBranch],
    );
    if (head === undefined || base === undefined) {
      context.logger.debug(
        `Snap finds no commit for ${head === undefined ? branch : baseBranch} in the git history`,
      );
      return undefined;
    }
    try {
      const mergeBase = (
        await context.git(['merge-base', '--end-of-options', head, base], context.cwd)
      ).trim();
      if (FULL_COMMIT.test(mergeBase)) return mergeBase;
    } catch (error) {
      context.logger.debug(`git merge-base found none yet: ${outputOf(error)}`);
    }
    if (!headFetchable && !baseFetchable) break;
  }
  context.logger.debug(`Snap finds no merge base of ${branch} and ${baseBranch}`);
  return undefined;
}

/** `start` and its ancestors, closest first, at most {@link SNAP_PARENT_COMMITS_MAX}. */
async function historyFrom(
  context: Context,
  start: string,
  shallow: boolean,
): Promise<string[] | undefined> {
  if (shallow && (await commitOf(context, start)) !== undefined) {
    await fetchFromOrigin(context, [`--depth=${SNAP_PARENT_COMMITS_MAX}`], [start]);
  }
  let output: string;
  try {
    output = await context.git(
      [
        'log',
        '--format=%H',
        `--max-count=${SNAP_PARENT_COMMITS_MAX}`,
        '--end-of-options',
        start,
        '--',
      ],
      context.cwd,
    );
  } catch (error) {
    context.logger.debug(`git log of ${start} failed: ${outputOf(error)}`);
    return undefined;
  }
  const commits = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (commits.length === 0 || !commits.every((sha) => FULL_COMMIT.test(sha))) return undefined;
  return commits.slice(0, SNAP_PARENT_COMMITS_MAX);
}

async function findParentCommits(
  input: SnapParentCommitsInput,
  git: GitRunner,
): Promise<string[] | undefined> {
  const context: Context = {
    cwd: input.cwd,
    git,
    logger: input.logger,
    sleep: input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const commit = input.commit.toLowerCase();
  if (!FULL_COMMIT.test(commit)) return undefined;
  let shallow: boolean;
  try {
    shallow = (await git(['rev-parse', '--is-shallow-repository'], input.cwd)).trim() === 'true';
  } catch (error) {
    input.logger.debug(
      `Snap reads no git history (git is missing or this is no git repository): ${outputOf(error)}`,
    );
    return undefined;
  }
  const { baseBranch } = input;
  const start =
    baseBranch === undefined || baseBranch === input.branch
      ? commit
      : await mergeBaseOf(context, { commit, branch: input.branch, baseBranch }, shallow);
  if (start === undefined) return undefined;
  const commits = await historyFrom(context, start, shallow);
  if (commits !== undefined) {
    input.logger.debug(`Snap looks for the baseline among ${commits.length} commits from ${start}`);
  }
  return commits;
}

const cache = new WeakMap<GitRunner, Map<string, Promise<string[] | undefined>>>();

/**
 * The commits Probara Snap picks the baseline build among: the merge base of `commit` and the base
 * branch (`commit` itself without one), then its ancestors, closest first, at most 300. Read once
 * per checkout, commit and branches in a process. Never rejects: `undefined` when git is missing,
 * the directory is no git repository, a fetch fails or no merge base is found, since a build
 * without a baseline is better than no build.
 */
export function snapParentCommits(input: SnapParentCommitsInput): Promise<string[] | undefined> {
  const git = input.git ?? runGit;
  let runs = cache.get(git);
  if (runs === undefined) {
    runs = new Map();
    cache.set(git, runs);
  }
  const key = JSON.stringify([input.cwd, input.commit, input.branch, input.baseBranch]);
  let found = runs.get(key);
  if (found === undefined) {
    found = findParentCommits(input, git).catch((error: unknown) => {
      input.logger.debug(`Snap reads no git history: ${outputOf(error)}`);
      return undefined;
    });
    runs.set(key, found);
  }
  return found;
}
