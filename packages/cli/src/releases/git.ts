/**
 * What `probara releases set-commits` reads from the local repository: the GitHub repository of the
 * origin remote, the HEAD commit, and the commits of a range. Git runs without a shell.
 */
import { execFile } from 'node:child_process';

export interface LocalCommit {
  sha: string;
  repository: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** ISO 8601 with the offset of the committer. */
  timestamp: string;
  files: string[];
}

/** Git could not answer: not a repository, no origin, an unknown commit. */
export class GitError extends Error {
  override readonly name = 'GitError';
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) resolve(stdout);
        else {
          const reason = stderr.trim().split('\n')[0] ?? '';
          reject(new GitError(`git ${args[0] ?? ''} failed${reason === '' ? '' : `: ${reason}`}`));
        }
      },
    );
  });
}

const GITHUB_REMOTE =
  /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|[^@/\s]+@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

/** The `owner/name` of a GitHub remote URL (https or ssh); none for another host. */
export function githubRepositoryOf(remote: string): string | undefined {
  const match = GITHUB_REMOTE.exec(remote.trim());
  return match === null ? undefined : `${match[1] ?? ''}/${match[2] ?? ''}`;
}

/**
 * The GitHub repository of the origin remote.
 *
 * @throws GitError when there is no origin, or it is not on GitHub (its URL is never shown: it may
 * hold credentials).
 */
export async function originRepository(cwd: string): Promise<string> {
  const remote = await git(cwd, ['remote', 'get-url', 'origin']);
  const repository = githubRepositoryOf(remote);
  if (repository === undefined) {
    throw new GitError(
      'the origin remote is not a GitHub repository: name the repository with --commit <owner/name>@<sha>',
    );
  }
  return repository;
}

export async function headCommit(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).trim();
}

const RECORD = '\x1e';
const FIELD = '\x1f';

/**
 * The commits of HEAD, newest first: those after `previous` when given, else the last `depth`; at
 * most `limit`.
 */
export async function localCommits(
  cwd: string,
  repository: string,
  range: { previous?: string; depth: number },
  limit: number,
): Promise<LocalCommit[]> {
  const revisions =
    range.previous === undefined
      ? [`--max-count=${Math.min(range.depth, limit)}`, 'HEAD']
      : [`--max-count=${limit}`, `${range.previous}..HEAD`];
  const log = await git(cwd, [
    'log',
    `--format=${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%cI${FIELD}%B${FIELD}`,
    '--name-only',
    ...revisions,
    '--',
  ]);
  return log
    .split(RECORD)
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [
        sha = '',
        authorName = '',
        authorEmail = '',
        timestamp = '',
        message = '',
        files = '',
      ] = record.split(FIELD);
      return {
        sha,
        repository,
        message: message.trim(),
        authorName,
        authorEmail,
        timestamp,
        files: files.split('\n').filter((file) => file !== ''),
      };
    });
}
