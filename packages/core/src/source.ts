import {
  COMMIT_PATTERN,
  GITHUB_COMMIT_PATTERN,
  MAX_BRANCH_LENGTH,
  MAX_BUILD_URL_LENGTH,
  MAX_CI_RUN_ATTEMPT,
  MAX_CI_RUN_ID_LENGTH,
  MAX_CI_TEXT_LENGTH,
  MAX_COMMIT_LENGTH,
  MAX_PULL_REQUEST_NUMBER,
  REPOSITORY_PATTERN,
} from './limits.js';
import { removeControlCharacters, toWellFormed } from './text.js';

/** The CI provider of a run source: GitHub Actions, or another one. */
export type RunSourceProvider = 'github_actions' | 'other';

/**
 * The CI source of a run: where its results were built. A GitHub Actions source with a
 * `repository` and a `ciRunId` names one workflow run attempt: the reports of its jobs that create
 * no run of their own go into one run ({@link groupsCiRun}).
 */
export interface RunSource {
  branch?: string;
  commit?: string;
  buildUrl?: string;
  /** `github_actions` or `other`. With `github_actions`, `commit` is a 7 to 40 character hex SHA. */
  provider?: RunSourceProvider;
  /** `owner/name`. */
  repository?: string;
  /** Who triggered the build. */
  commitAuthor?: string;
  /** The pull request the build is for. */
  pullRequestNumber?: number;
  /** The CI workflow (pipeline) name. */
  workflow?: string;
  /** The CI run, the same in every job of a workflow run. */
  ciRunId?: string;
  /** The attempt of the CI run: 1, then 2 for a re-run... The server takes 1 when it is left out. */
  ciRunAttempt?: number;
  /** The CI job. */
  ciJob?: string;
}

const PROVIDERS: readonly string[] = ['github_actions', 'other'];

/**
 * Whether `source` names one GitHub Actions workflow run attempt (`provider: github_actions`, a
 * `repository` and a `ciRunId`): reports without `run.ulid` that carry it append to one run. Shards
 * leave it open (`closeRun: false`) and a final job closes it.
 */
export function groupsCiRun(source: Readonly<RunSource>): boolean {
  return (
    source.provider === 'github_actions' &&
    source.repository !== undefined &&
    source.ciRunId !== undefined
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isIntegerIn(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * Keeps the fields of `source` the server accepts. An invalid field is dropped, never cut (a
 * truncated branch or URL is wrong data), and `warn` names it without echoing its value.
 */
export function sanitizeRunSource(source: RunSource, warn: (message: string) => void): RunSource {
  const sanitized: RunSource = {};

  /** A one-line text field of 1..`max` characters, without control characters. */
  const text = (field: 'branch' | 'commitAuthor' | 'workflow' | 'ciJob', max: number) => {
    const raw = source[field];
    if (raw === undefined) return;
    const value = removeControlCharacters(raw).trim();
    if (value === '') warn(`Ignored a blank source ${field}`);
    else if (value.length > max) warn(`Ignored a source ${field} longer than ${max} characters`);
    else sanitized[field] = value;
  };

  text('branch', MAX_BRANCH_LENGTH);

  if (source.commit !== undefined) {
    const commit = source.commit.trim();
    if (source.provider === 'github_actions') {
      if (GITHUB_COMMIT_PATTERN.test(commit)) sanitized.commit = commit;
      else {
        warn(
          'Ignored a source commit that is not a 7 to 40 character hex SHA (provider github_actions)',
        );
      }
    } else if (commit.length <= MAX_COMMIT_LENGTH && COMMIT_PATTERN.test(commit)) {
      sanitized.commit = commit;
    } else {
      warn(
        `Ignored a source commit that is not 1 to ${MAX_COMMIT_LENGTH} visible ASCII characters`,
      );
    }
  }

  if (source.buildUrl !== undefined) {
    const buildUrl = toWellFormed(source.buildUrl).trim();
    if (buildUrl.length <= MAX_BUILD_URL_LENGTH && isHttpUrl(buildUrl)) {
      sanitized.buildUrl = buildUrl;
    } else {
      warn(
        `Ignored a source buildUrl that is not an http(s) URL of at most ${MAX_BUILD_URL_LENGTH} characters`,
      );
    }
  }

  if (source.provider !== undefined) {
    if (PROVIDERS.includes(source.provider)) sanitized.provider = source.provider;
    else warn('Ignored a source provider that is not github_actions or other');
  }

  if (source.repository !== undefined) {
    const repository = source.repository.trim();
    if (REPOSITORY_PATTERN.test(repository)) sanitized.repository = repository;
    else warn('Ignored a source repository that is not owner/name');
  }

  text('commitAuthor', MAX_CI_TEXT_LENGTH);

  if (source.pullRequestNumber !== undefined) {
    if (isIntegerIn(source.pullRequestNumber, MAX_PULL_REQUEST_NUMBER)) {
      sanitized.pullRequestNumber = source.pullRequestNumber;
    } else {
      warn(
        `Ignored a source pullRequestNumber that is not an integer from 1 to ${MAX_PULL_REQUEST_NUMBER}`,
      );
    }
  }

  text('workflow', MAX_CI_TEXT_LENGTH);

  if (source.ciRunId !== undefined) {
    const ciRunId = source.ciRunId.trim();
    if (ciRunId.length <= MAX_CI_RUN_ID_LENGTH && COMMIT_PATTERN.test(ciRunId)) {
      sanitized.ciRunId = ciRunId;
    } else {
      warn(
        `Ignored a source ciRunId that is not 1 to ${MAX_CI_RUN_ID_LENGTH} visible ASCII characters`,
      );
    }
  }

  if (source.ciRunAttempt !== undefined) {
    if (isIntegerIn(source.ciRunAttempt, MAX_CI_RUN_ATTEMPT)) {
      sanitized.ciRunAttempt = source.ciRunAttempt;
    } else {
      warn(`Ignored a source ciRunAttempt that is not an integer from 1 to ${MAX_CI_RUN_ATTEMPT}`);
    }
  }

  text('ciJob', MAX_CI_TEXT_LENGTH);

  return sanitized;
}
