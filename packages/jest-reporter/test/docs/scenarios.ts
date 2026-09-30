/**
 * The setups behind `scenario: <id>` in output, sent and files blocks. The command comes from the
 * block; a scenario only says what the environment and the fake Probara look like.
 */
import type { FakeProbara, FakeProbaraOptions } from '@probara/test-support/fake-probara';

export interface Scenario {
  /** Merged over the configured job's environment; `undefined` removes a variable. */
  env?: Record<string, string | undefined>;
  /** How the fake Probara starts, such as the members `assignFailedTo` may name. */
  fake?: FakeProbaraOptions;
  setup?: (fake: FakeProbara) => void;
}

/** The run the docs name, such as in `PROBARA_RUN_ULID=01J9Z3K4M5N6P7Q8R9S0T1V2W3`. */
export const DOCS_RUN = '01J9Z3K4M5N6P7Q8R9S0T1V2W3';

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
  /**
   * The run `01J9Z3K4M5N6P7Q8R9S0T1V2W3` of the docs, open, with two cases of the docs project's
   * tests: `SHOP-12`, named in a title, and `SHOP-30`, linked by the key of the login test.
   */
  'run-cases': {
    setup: (fake) => {
      fake.seedRun({
        ulid: DOCS_RUN,
        projectId: 'SHOP',
        cases: [
          { caseDisplayId: 'SHOP-12', automationKey: null },
          {
            caseDisplayId: 'SHOP-30',
            automationKey: 'tests/login.test.js > login logs in with a valid password',
          },
        ],
      });
    },
  },
};
