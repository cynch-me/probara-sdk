/** Detection of the CI provider a run is reported from, and of its build details. */
import { readFileSync } from 'node:fs';

/** What the CI environment tells about the build a run belongs to. */
export interface CiInfo {
  /** The detected CI provider, such as `github-actions`. */
  provider?: string;
  branch?: string;
  commit?: string;
  buildUrl?: string;
  /** A readable build name such as `CI #42`, the default run name. */
  buildName?: string;
  /** GitHub Actions only: the repository, `owner/name`. */
  repository?: string;
  /** GitHub Actions only: who triggered the workflow run (`GITHUB_ACTOR`). */
  commitAuthor?: string;
  /** GitHub Actions only: the pull request of a `refs/pull/<n>/merge` build. */
  pullRequestNumber?: number;
  /** GitHub Actions only: the workflow name. */
  workflow?: string;
  /** GitHub Actions only: the workflow run id, the same in every job of the run. */
  ciRunId?: string;
  /** GitHub Actions only: the attempt of the workflow run (1, then 2 for a re-run...). */
  ciRunAttempt?: number;
  /** GitHub Actions only: the job id. */
  ciJob?: string;
}

/**
 * What a Probara Snap build needs from the CI on top of {@link CiInfo}: the commit and the base
 * branch screenshots are compared for, and what makes the jobs of one CI run join one build.
 */
export interface SnapCiInfo extends CiInfo {
  /**
   * The commit the screenshots are of. On a GitHub Actions `pull_request` event, the head of the
   * pull request (`pull_request.head.sha` of the event payload at `GITHUB_EVENT_PATH`), since
   * `commit` is then the merge commit; otherwise `commit`.
   */
  headCommit?: string;
  /** The branch a pull or merge request targets, where the provider says. */
  baseBranch?: string;
  /**
   * What the jobs of one CI run share: the run id and attempt on GitHub Actions (`9876-2`), else
   * the provider's pipeline id.
   */
  snapNonce?: string;
}

/** Reads a file as UTF-8 text; throws when it cannot. */
export type ReadTextFile = (path: string) => string;

type Env = Readonly<Record<string, string | undefined>>;
type Read = (name: string) => string | undefined;
/** The fields a provider reads, `undefined` when its variables are missing. */
type Detected = { [field in keyof CiInfo]?: CiInfo[field] | undefined };

interface Provider {
  name: string;
  detect(read: Read): boolean;
  info(read: Read): Omit<Detected, 'provider'>;
  /** The variable of the branch a pull or merge request targets, when the provider has one. */
  baseBranch?: string;
  /** What the jobs of one pipeline share, apart from re-runs where the provider tells them apart. */
  nonce(read: Read): string | undefined;
}

/** `value` as a positive integer of digits only, else `undefined`. */
function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

/** The pull request number of a `refs/pull/<n>/merge` ref, else `undefined`. */
function pullRequestOf(ref: string | undefined): number | undefined {
  return positiveInteger(/^refs\/pull\/(\d+)\/merge$/.exec(ref ?? '')?.[1]);
}

/** `template` filled with `values`, or `undefined` when any value is missing. */
function compose(
  values: readonly (string | undefined)[],
  template: (...values: string[]) => string,
): string | undefined {
  if (values.some((value) => value === undefined)) return undefined;
  return template(...(values as string[]));
}

function stripPrefix(value: string | undefined, prefix: string): string | undefined {
  return value?.startsWith(prefix) === true ? value.slice(prefix.length) : value;
}

/** `branch`, or `undefined` when it is the name of the tag being built. */
function unlessTag(branch: string | undefined, tag: string | undefined): string | undefined {
  return tag !== undefined && branch === tag ? undefined : branch;
}

/** An Azure source ref as a branch: `refs/heads/` stripped, a tag (`refs/tags/`) left out. */
function azureBranch(ref: string | undefined): string | undefined {
  return ref?.startsWith('refs/tags/') === true ? undefined : stripPrefix(ref, 'refs/heads/');
}

function buildNameOf(read: Read, project: string, number: string): string | undefined {
  return compose([read(project), read(number)], (name, id) => `${name} #${id}`);
}

const PROVIDERS: readonly Provider[] = [
  {
    name: 'github-actions',
    detect: (read) => read('GITHUB_ACTIONS') === 'true',
    info: (read) => ({
      // On a tag build GITHUB_REF_NAME is the tag, not a branch.
      branch:
        read('GITHUB_HEAD_REF') ??
        (read('GITHUB_REF_TYPE') === 'tag' ? undefined : read('GITHUB_REF_NAME')),
      commit: read('GITHUB_SHA'),
      buildUrl: compose(
        [read('GITHUB_SERVER_URL'), read('GITHUB_REPOSITORY'), read('GITHUB_RUN_ID')],
        (server, repository, runId) => `${server}/${repository}/actions/runs/${runId}`,
      ),
      buildName: buildNameOf(read, 'GITHUB_WORKFLOW', 'GITHUB_RUN_NUMBER'),
      repository: read('GITHUB_REPOSITORY'),
      commitAuthor: read('GITHUB_ACTOR'),
      pullRequestNumber: pullRequestOf(read('GITHUB_REF')),
      workflow: read('GITHUB_WORKFLOW'),
      ciRunId: read('GITHUB_RUN_ID'),
      ciRunAttempt: positiveInteger(read('GITHUB_RUN_ATTEMPT')),
      ciJob: read('GITHUB_JOB'),
    }),
    baseBranch: 'GITHUB_BASE_REF',
    nonce: (read) =>
      compose([read('GITHUB_RUN_ID')], (runId) => `${runId}-${read('GITHUB_RUN_ATTEMPT') ?? '1'}`),
  },
  {
    name: 'gitlab',
    detect: (read) => read('GITLAB_CI') === 'true',
    info: (read) => ({
      // On a tag pipeline CI_COMMIT_REF_NAME is the tag, not a branch.
      branch:
        read('CI_MERGE_REQUEST_SOURCE_BRANCH_NAME') ??
        (read('CI_COMMIT_TAG') === undefined ? read('CI_COMMIT_REF_NAME') : undefined),
      commit: read('CI_COMMIT_SHA'),
      buildUrl: read('CI_PIPELINE_URL'),
      buildName: buildNameOf(read, 'CI_PROJECT_NAME', 'CI_PIPELINE_IID'),
    }),
    baseBranch: 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME',
    nonce: (read) => read('CI_PIPELINE_ID'),
  },
  {
    name: 'circleci',
    detect: (read) => read('CIRCLECI') === 'true',
    info: (read) => ({
      branch: read('CIRCLE_BRANCH'),
      commit: read('CIRCLE_SHA1'),
      buildUrl: read('CIRCLE_BUILD_URL'),
      buildName: buildNameOf(read, 'CIRCLE_PROJECT_REPONAME', 'CIRCLE_BUILD_NUM'),
    }),
    nonce: (read) => read('CIRCLE_WORKFLOW_ID'),
  },
  {
    name: 'azure-pipelines',
    detect: (read) => read('TF_BUILD')?.toLowerCase() === 'true',
    info: (read) => ({
      branch: azureBranch(read('SYSTEM_PULLREQUEST_SOURCEBRANCH') ?? read('BUILD_SOURCEBRANCH')),
      commit: read('BUILD_SOURCEVERSION'),
      buildUrl: compose(
        [read('SYSTEM_COLLECTIONURI'), read('SYSTEM_TEAMPROJECT'), read('BUILD_BUILDID')],
        (collection, project, buildId) =>
          `${collection.replace(/\/*$/, '/')}${encodeURIComponent(project)}/_build/results?buildId=${encodeURIComponent(buildId)}`,
      ),
      buildName: buildNameOf(read, 'BUILD_DEFINITIONNAME', 'BUILD_BUILDNUMBER'),
    }),
    baseBranch: 'SYSTEM_PULLREQUEST_TARGETBRANCH',
    nonce: (read) => read('BUILD_BUILDID'),
  },
  {
    name: 'jenkins',
    detect: (read) => read('JENKINS_URL') !== undefined,
    info: (read) => ({
      // A multibranch tag build sets BRANCH_NAME to the tag.
      branch: unlessTag(
        read('BRANCH_NAME') ?? stripPrefix(read('GIT_BRANCH'), 'origin/'),
        read('TAG_NAME'),
      ),
      commit: read('GIT_COMMIT'),
      buildUrl: read('BUILD_URL'),
      buildName: buildNameOf(read, 'JOB_NAME', 'BUILD_NUMBER'),
    }),
    baseBranch: 'CHANGE_TARGET',
    nonce: (read) => read('BUILD_TAG'),
  },
  {
    name: 'bitbucket',
    detect: (read) => read('BITBUCKET_BUILD_NUMBER') !== undefined,
    info: (read) => ({
      branch: read('BITBUCKET_BRANCH'),
      commit: read('BITBUCKET_COMMIT'),
      buildUrl: compose(
        [read('BITBUCKET_REPO_FULL_NAME'), read('BITBUCKET_BUILD_NUMBER')],
        (repository, number) => `https://bitbucket.org/${repository}/pipelines/results/${number}`,
      ),
      buildName: buildNameOf(read, 'BITBUCKET_REPO_SLUG', 'BITBUCKET_BUILD_NUMBER'),
    }),
    baseBranch: 'BITBUCKET_PR_DESTINATION_BRANCH',
    nonce: (read) => read('BITBUCKET_PIPELINE_UUID'),
  },
  {
    name: 'buildkite',
    detect: (read) => read('BUILDKITE') === 'true',
    info: (read) => ({
      // A tag build sets BUILDKITE_BRANCH to the tag.
      branch: unlessTag(read('BUILDKITE_BRANCH'), read('BUILDKITE_TAG')),
      commit: read('BUILDKITE_COMMIT'),
      buildUrl: read('BUILDKITE_BUILD_URL'),
      buildName: buildNameOf(read, 'BUILDKITE_PIPELINE_SLUG', 'BUILDKITE_BUILD_NUMBER'),
    }),
    baseBranch: 'BUILDKITE_PULL_REQUEST_BASE_BRANCH',
    nonce: (read) => read('BUILDKITE_BUILD_ID'),
  },
];

/** A reader of `env` that trims values and treats blank ones as unset. */
export function envReader(env: Env): Read {
  return (name) => {
    const value = env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };
}

/**
 * Detects the CI provider from its marker variable (first match wins) and reads the branch,
 * commit, build URL and build name it exposes; on GitHub Actions also the repository, actor, pull
 * request, workflow, run id, run attempt and job. `PROBARA_BRANCH`, `PROBARA_COMMIT` and
 * `PROBARA_BUILD_URL` override the detected values. Values are returned as found: pass them
 * through `sanitizeRunSource` before sending them.
 */
export function detectCiSource(env: Env = process.env): CiInfo {
  const read = envReader(env);
  const provider = PROVIDERS.find((candidate) => candidate.detect(read));
  const detected = provider?.info(read);
  const values: Detected = {
    ...detected,
    provider: provider?.name,
    branch: read('PROBARA_BRANCH') ?? detected?.branch,
    commit: read('PROBARA_COMMIT') ?? detected?.commit,
    buildUrl: read('PROBARA_BUILD_URL') ?? detected?.buildUrl,
  };
  const info: Record<string, string | number> = {};
  for (const [field, value] of Object.entries(values)) {
    if (value !== undefined) info[field] = value;
  }
  return info;
}

/** The base branch and the pull request of a GitHub merge queue branch, else `undefined`. */
function mergeQueueOf(
  branch: string | undefined,
): { baseBranch: string; pullRequestNumber: number } | undefined {
  const match = /^gh-readonly-queue\/(.+)\/pr-(\d+)-[0-9a-f]+$/.exec(branch ?? '');
  const pullRequestNumber = positiveInteger(match?.[2]);
  if (match?.[1] === undefined || pullRequestNumber === undefined) return undefined;
  return { baseBranch: match[1], pullRequestNumber };
}

/** The head commit of the pull request in a GitHub event payload, else `undefined`. */
function pullRequestHeadOf(path: string, readFile: ReadTextFile): string | undefined {
  try {
    const event = JSON.parse(readFile(path)) as { pull_request?: { head?: { sha?: unknown } } };
    const sha = event.pull_request?.head?.sha;
    return typeof sha === 'string' && sha.trim() !== '' ? sha.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * {@link detectCiSource}, plus what a Probara Snap build is created from: the head commit (see
 * {@link SnapCiInfo.headCommit}; `PROBARA_COMMIT` wins), the base branch of a pull or merge
 * request (GitHub Actions, GitLab, Azure Pipelines, Jenkins multibranch, Bitbucket, Buildkite),
 * and the nonce the jobs of one CI run share. A GitHub Actions `merge_group` run keeps its queue
 * branch (`gh-readonly-queue/<base>/pr-<n>-<sha>`) and reports `<base>` as the base branch and
 * `<n>` as the pull request. The other fields of `detectCiSource` are reported as it reports them.
 */
export function detectSnapCiSource(
  env: Env = process.env,
  readFile: ReadTextFile = (path) => readFileSync(path, 'utf8'),
): SnapCiInfo {
  const read = envReader(env);
  const info: SnapCiInfo = detectCiSource(env);
  const provider = PROVIDERS.find((candidate) => candidate.detect(read));
  const eventPath = read('GITHUB_EVENT_PATH');
  const pullRequestHead =
    provider?.name === 'github-actions' &&
    read('GITHUB_EVENT_NAME')?.startsWith('pull_request') === true &&
    eventPath !== undefined
      ? pullRequestHeadOf(eventPath, readFile)
      : undefined;
  const headCommit = read('PROBARA_COMMIT') ?? pullRequestHead ?? info.commit;
  const baseBranch =
    provider?.baseBranch === undefined
      ? undefined
      : stripPrefix(read(provider.baseBranch), 'refs/heads/');
  const snapNonce = provider?.nonce(read);
  const mergeQueue =
    provider?.name === 'github-actions' && read('GITHUB_EVENT_NAME') === 'merge_group'
      ? mergeQueueOf(info.branch)
      : undefined;
  if (mergeQueue !== undefined) {
    info.pullRequestNumber = mergeQueue.pullRequestNumber;
    info.baseBranch = mergeQueue.baseBranch;
  }
  if (headCommit !== undefined) info.headCommit = headCommit;
  if (baseBranch !== undefined && mergeQueue === undefined) info.baseBranch = baseBranch;
  if (snapNonce !== undefined) info.snapNonce = snapNonce;
  return info;
}
