/**
 * The setups behind `scenario: <id>` in output and sent blocks. The command comes from the block;
 * a scenario only says what the environment and the fake Probara look like.
 */
import type { FakeProbara } from '@probara/test-support/fake-probara';

export interface Scenario {
  /** Merged over the configured job's environment; `undefined` removes a variable. */
  env?: Record<string, string | undefined>;
  setup?: (fake: FakeProbara) => void;
}

/**
 * An error body whose message stands for whatever Probara says: the docs never quote a server
 * message the fake made up.
 */
function probaraError(code: string) {
  return { error: { code, message: '<message from Probara>' } };
}

const GITHUB_JOB = {
  GITHUB_ACTIONS: 'true',
  GITHUB_SHA: '3f2a9c1d5e7b8a6f4c0d2e1b9a8f7c6d5e4b3a21',
  GITHUB_REF_NAME: 'main',
  GITHUB_RUN_ID: '9876',
  GITHUB_RUN_ATTEMPT: '1',
};

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  /** A configured job and a Probara that records everything. */
  '': {},
  /** Every report is refused with a 403 (not retried). */
  refused: {
    setup: (fake) => {
      fake.fail('report', { status: 403, body: probaraError('forbidden') });
    },
  },
  /** The token is refused. */
  unauthorized: {
    setup: (fake) => {
      fake.fail('report', { status: 401, body: probaraError('unauthorized') });
    },
  },
  /** A GitHub Actions job: the commit, the branch and the run the Snap build is created from. */
  snap: { env: GITHUB_JOB },
  /** The same job, once the plan's monthly Snap screenshots are used up. */
  'snap-limit': {
    env: GITHUB_JOB,
    setup: (fake) => {
      fake.fail('snapFinalizeShard', {
        status: 409,
        body: probaraError('snap_screenshot_limit_reached'),
      });
    },
  },
  /** No token and no project: reporting stays off and quiet. */
  'not-configured': { env: { PROBARA_API_TOKEN: undefined, PROBARA_PROJECT: undefined } },
  /** Only the project: a fork pull request without secrets. */
  'no-token': { env: { PROBARA_API_TOKEN: undefined } },
};
