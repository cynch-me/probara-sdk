/** Detection of the CI provider a run is reported from, and of its build details. */

/** What the CI environment tells about the build a run belongs to. */
export interface CiInfo {
  /** The detected CI provider, such as `github-actions`. */
  provider?: string;
  branch?: string;
  commit?: string;
  buildUrl?: string;
  /** A readable build name such as `CI #42`, the default run name. */
  buildName?: string;
}

type Env = Readonly<Record<string, string | undefined>>;
type Read = (name: string) => string | undefined;
/** The fields a provider reads, `undefined` when its variables are missing. */
type Detected = { [field in keyof CiInfo]: string | undefined };

interface Provider {
  name: string;
  detect(read: Read): boolean;
  info(read: Read): Omit<Detected, 'provider'>;
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
    }),
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
 * commit, build URL and build name it exposes. `PROBARA_BRANCH`, `PROBARA_COMMIT` and
 * `PROBARA_BUILD_URL` override the detected values. Values are returned as found: pass them
 * through `sanitizeRunSource` before sending them.
 */
export function detectCiSource(env: Env = process.env): CiInfo {
  const read = envReader(env);
  const provider = PROVIDERS.find((candidate) => candidate.detect(read));
  const detected = provider?.info(read);
  const values: Detected = {
    provider: provider?.name,
    branch: read('PROBARA_BRANCH') ?? detected?.branch,
    commit: read('PROBARA_COMMIT') ?? detected?.commit,
    buildUrl: read('PROBARA_BUILD_URL') ?? detected?.buildUrl,
    buildName: detected?.buildName,
  };
  const info: CiInfo = {};
  for (const [field, value] of Object.entries(values) as [keyof CiInfo, string | undefined][]) {
    if (value !== undefined) info[field] = value;
  }
  return info;
}
