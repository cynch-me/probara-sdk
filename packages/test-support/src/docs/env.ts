/**
 * The environment the docs examples of a reporter run in: a configured CI job whose requests all
 * reach the fake Probara, whatever the variables a command line of the docs sets.
 */
import { REDIRECT_FETCH_URL } from './redirect.js';

/**
 * Variables a command line of the docs may set that its run leaves out: the fake only accepts its
 * own token, and a proxy or a certificate authority of the example's network is not the fake's.
 */
export const NOT_PASSED: ReadonlySet<string> = new Set([
  'PROBARA_API_TOKEN',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA',
]);

export interface DocsJob {
  /** The token the fake accepts. */
  token: string;
  /** The fake's URL, which every request goes to. */
  fakeUrl: string;
  /** `PROBARA_PROJECT`; left out when `undefined` (a config that names its project). */
  project?: string | undefined;
  /** Merged over the job's variables; `undefined` removes one. The redirect always stays. */
  extra?: Record<string, string | undefined>;
}

/** The environment of a configured CI job, reporting to the fake whatever the base URL. */
export function docsEnvOf({
  token,
  fakeUrl,
  project,
  extra = {},
}: DocsJob): Record<string, string> {
  const env: Record<string, string | undefined> = {
    PROBARA_API_TOKEN: token,
    ...(project === undefined ? {} : { PROBARA_PROJECT: project }),
    ...extra,
    PROBARA_DOCS_FAKE_URL: fakeUrl,
    NODE_OPTIONS: `--import=${REDIRECT_FETCH_URL}`,
  };
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * The environment of a command: the job's `env`, with the variables its line assigns but those
 * {@link NOT_PASSED}; the redirect and the fake stay whatever the line sets.
 */
export function runEnvOf(
  assignments: readonly (readonly [string, string])[],
  env: Record<string, string>,
): Record<string, string> {
  const assigned = assignments.filter(([name]) => !NOT_PASSED.has(name));
  return {
    ...env,
    ...Object.fromEntries(assigned),
    ...(env.NODE_OPTIONS === undefined ? {} : { NODE_OPTIONS: env.NODE_OPTIONS }),
    ...(env.PROBARA_DOCS_FAKE_URL === undefined
      ? {}
      : { PROBARA_DOCS_FAKE_URL: env.PROBARA_DOCS_FAKE_URL }),
  };
}
