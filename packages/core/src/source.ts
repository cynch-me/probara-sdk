import {
  COMMIT_PATTERN,
  MAX_BRANCH_LENGTH,
  MAX_BUILD_URL_LENGTH,
  MAX_COMMIT_LENGTH,
} from './limits.js';
import { removeControlCharacters, toWellFormed } from './text.js';

/** The CI source of a run: where its results were built. */
export interface RunSource {
  branch?: string;
  commit?: string;
  buildUrl?: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Keeps the fields of `source` the server accepts. An invalid field is dropped, never cut (a
 * truncated branch or URL is wrong data), and `warn` names it without echoing its value.
 */
export function sanitizeRunSource(source: RunSource, warn: (message: string) => void): RunSource {
  const sanitized: RunSource = {};

  if (source.branch !== undefined) {
    const branch = removeControlCharacters(source.branch).trim();
    if (branch === '') warn('Ignored a blank source branch');
    else if (branch.length > MAX_BRANCH_LENGTH) {
      warn(`Ignored a source branch longer than ${MAX_BRANCH_LENGTH} characters`);
    } else sanitized.branch = branch;
  }

  if (source.commit !== undefined) {
    const commit = source.commit.trim();
    if (commit.length <= MAX_COMMIT_LENGTH && COMMIT_PATTERN.test(commit)) {
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

  return sanitized;
}
