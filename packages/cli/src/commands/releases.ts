/**
 * `probara releases set-commits` tells Probara which commits a release contains, so an issue of the
 * error monitoring shows its suspect commits, and a commit that says "fixes ERR-<n>" resolves it.
 */
import { resolveSetup } from '../configuration.js';
import { EXIT_OK, EXIT_REPORTING_FAILED, EXIT_USAGE } from '../exit-codes.js';
import { sendWithRetries } from '../http/retry.js';
import { stringOf, toCoreOptions, UsageError, type ParsedCommandLine } from '../options.js';
import {
  GitError,
  headCommit,
  localCommits,
  originRepository,
  type LocalCommit,
} from '../releases/git.js';
import type { CommandContext } from './context.js';
import { plural } from './reporting.js';

const HELP = 'probara releases set-commits';
const MAX_REFS = 10;
const MAX_COMMITS = 100;
const DEFAULT_DEPTH = 20;
const COMMIT_REF = /^([\w.-]+\/[\w.-]+)@(?:([^\s.@]+)\.\.)?([^\s.@]+)$/;

interface Ref {
  repository: string;
  commit: string;
  previousCommit?: string;
}

type Body = { release: string; refs: Ref[] } | { release: string; commits: LocalCommit[] };

interface Recorded {
  items: unknown[];
  resolvedIssues: { ulid: string; displayId: string }[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function refOf(value: string): Ref {
  const match = COMMIT_REF.exec(value.trim());
  if (match === null) {
    throw new UsageError(
      `--commit takes <owner/name>@<sha> or <owner/name>@<previous>..<sha>, such as acme/shop@4f2a9c1, not "${value}"`,
      HELP,
    );
  }
  const [, repository = '', previousCommit, commit = ''] = match;
  return previousCommit === undefined
    ? { repository, commit }
    : { repository, commit, previousCommit };
}

function shaOf(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const sha = value.trim();
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) throw new UsageError(`${flag} must be a commit SHA`, HELP);
  return sha;
}

/** The body the mode of the command line sends, read from git for --auto and --local. */
async function bodyOf(
  values: ParsedCommandLine['values'],
  release: string,
  cwd: string,
  warn: (message: string) => void,
): Promise<Body> {
  const auto = values.get('auto') === true;
  const local = values.get('local') === true;
  const commits = values.get('commit');
  const given = Array.isArray(commits) ? commits : [];
  if ([auto, local, given.length > 0].filter(Boolean).length !== 1) {
    throw new UsageError('Give exactly one of --auto, --commit and --local', HELP);
  }
  const previous = shaOf(stringOf(values, 'previous-commit'), '--previous-commit');
  const depth = values.get('initial-depth');
  if (!local && (previous !== undefined || depth !== undefined)) {
    throw new UsageError('--previous-commit and --initial-depth go with --local', HELP);
  }
  if (typeof depth === 'number' && (depth < 1 || depth > MAX_COMMITS)) {
    throw new UsageError(`--initial-depth must be 1 to ${MAX_COMMITS}`, HELP);
  }
  if (given.length > 0) {
    if (given.length > MAX_REFS) {
      throw new UsageError(`Give at most ${MAX_REFS} --commit, one per repository`, HELP);
    }
    return { release, refs: given.map(refOf) };
  }
  try {
    const repository = await originRepository(cwd);
    if (auto) return { release, refs: [{ repository, commit: await headCommit(cwd) }] };
    const found = await localCommits(
      cwd,
      repository,
      {
        ...(previous === undefined ? {} : { previous }),
        depth: typeof depth === 'number' ? depth : DEFAULT_DEPTH,
      },
      MAX_COMMITS + 1,
    );
    if (found.length > MAX_COMMITS) {
      warn(
        `More than ${MAX_COMMITS} commits follow ${previous ?? 'HEAD'}: only the newest ${MAX_COMMITS} are sent`,
      );
    }
    return { release, commits: found.slice(0, MAX_COMMITS) };
  } catch (error) {
    if (error instanceof GitError) throw new UsageError(error.message, HELP);
    throw error;
  }
}

function describeBody(body: Body): string {
  return 'refs' in body
    ? `the commits up to ${body.refs.map((ref) => `${ref.repository}@${ref.commit}`).join(', ')}`
    : plural(body.commits.length, 'commit');
}

export async function setCommitsCommand(
  { values }: ParsedCommandLine,
  context: CommandContext,
  clientName: string,
): Promise<number> {
  const { io, logger, output } = context;
  const release = stringOf(values, 'release')?.trim() ?? '';
  if (release === '') {
    throw new UsageError('--release is required: the release the SDK sends with its events', HELP);
  }
  const dryRun = values.get('dry-run') === true;
  const json = values.get('json') === true;
  const options = { ...toCoreOptions('releases set-commits', values, io.cwd), clientName };
  const setup = resolveSetup(options, io.env, { requireCredentials: !dryRun, now: io.now });
  logger.debugEnabled = setup.kind === 'ready' ? setup.config.debug : values.get('debug') === true;
  for (const warning of setup.warnings) logger.debug(warning);
  if (setup.kind === 'invalid') {
    for (const problem of setup.problems) logger.error(problem);
    return EXIT_USAGE;
  }

  const body = await bodyOf(values, release, io.cwd, (message) => {
    logger.warn(message);
  });
  if ('commits' in body && body.commits.length === 0) {
    logger.info(
      `No commit after ${stringOf(values, 'previous-commit') ?? 'HEAD'}: nothing was sent`,
    );
    if (json) output.json({ status: 'empty', release });
    return EXIT_OK;
  }
  if (dryRun) {
    output.json(json ? { status: 'dry-run', release, body } : body);
    logger.info(
      `Dry run: ${describeBody(body)} would be set for release ${release}; nothing was sent`,
    );
    return EXIT_OK;
  }
  if (setup.kind === 'disabled') {
    logger.info(`${setup.reason}: no commit was sent`);
    if (json) output.json({ status: 'disabled' });
    return EXIT_OK;
  }

  const { config } = setup;
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/api/v1/projects/${encodeURIComponent(
    config.projectId,
  )}/error-monitoring/release-commits`;
  const sent = await sendWithRetries(
    {
      apiToken: config.apiToken,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      fetch: io.fetch ?? globalThis.fetch,
      sleep: io.sleep ?? defaultSleep,
      now: () => io.now?.().getTime() ?? Date.now(),
      warn: (message) => {
        logger.warn(message);
      },
    },
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': `${clientName} node/${process.versions.node}`,
      },
      body: JSON.stringify(body),
    },
    `Setting the commits of release ${release}`,
  );
  const recorded = sent.ok ? await recordedOf(sent.response) : undefined;
  if (recorded === undefined) {
    const error = sent.ok
      ? 'Probara answered with a body that is not the recorded commits'
      : sent.error;
    logger.error(`Could not set the commits of release ${release}: ${error}`);
    if (json) output.json({ status: 'failed', release, error });
    return EXIT_REPORTING_FAILED;
  }
  logger.info(`Recorded ${plural(recorded.items.length, 'commit')} for release ${release}`);
  if (recorded.resolvedIssues.length > 0) {
    logger.info(`Resolved ${recorded.resolvedIssues.map(({ displayId }) => displayId).join(', ')}`);
  }
  if (json) {
    output.json({
      status: 'recorded',
      release,
      commits: recorded.items,
      resolvedIssues: recorded.resolvedIssues,
    });
  }
  return EXIT_OK;
}

async function recordedOf(response: Response): Promise<Recorded | undefined> {
  try {
    const answer = (await response.json()) as Partial<Recorded>;
    return Array.isArray(answer.items) && Array.isArray(answer.resolvedIssues)
      ? { items: answer.items, resolvedIssues: answer.resolvedIssues }
      : undefined;
  } catch {
    return undefined;
  }
}
