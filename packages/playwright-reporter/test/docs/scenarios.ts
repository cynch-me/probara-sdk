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
  /** No token and no project: reporting stays off and quiet. */
  'not-configured': { env: { PROBARA_API_TOKEN: undefined, PROBARA_PROJECT: undefined } },
  /** Only the project: a fork pull request without secrets. */
  'no-token': { env: { PROBARA_API_TOKEN: undefined } },
};
