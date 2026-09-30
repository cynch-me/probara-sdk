/**
 * The setups behind `scenario: <id>` in output, sent and files blocks. The command comes from the
 * block; a scenario only says what the environment and the fake Probara look like.
 */
import {
  startFakeProbara,
  type FakeProbara,
  type FakeProbaraOptions,
} from '@probara/test-support/fake-probara';
import { TOKEN } from '../support/workspace.js';

export interface Scenario {
  /** Merged over the configured job's environment; `undefined` removes a variable. */
  env?: Record<string, string | undefined>;
  /** How the fake Probara starts, such as the members `assignFailedTo` may name. */
  fake?: FakeProbaraOptions;
  setup?: (fake: FakeProbara) => void;
  /**
   * A `jest --watchAll` session: how many runs it makes (2 by default: the first and one re-run),
   * and what happens to Probara between two of them.
   */
  watch?: { runs?: number; between?: (fake: FakeProbara, ended: number) => void };
}

/**
 * The organization of the docs, whatever the scenario: it has the custom field `Risk area` that
 * `docs/metadata.md` sets on a created case.
 */
const DOCS_ORGANIZATION: FakeProbaraOptions = { customFields: ['Risk area'] };

/** The fake Probara of `scenario`, in the organization of the docs, taking the tests' token. */
export function startDocsFake(scenario: Scenario = {}): Promise<FakeProbara> {
  return startFakeProbara({ ...DOCS_ORGANIZATION, ...scenario.fake, token: TOKEN });
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

/**
 * The run of the docs with two cases of the docs project's tests: `SHOP-12`, named in a title, and
 * `SHOP-30`, linked by the key of the login test.
 */
function seedRunWithCases(fake: FakeProbara): void {
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
  /**
   * The first report of a watch session's re-run is refused: its run was closed in Probara (a 409
   * `conflict`, which is not retried).
   */
  'watch-run-closed': {
    setup: (fake) => {
      fake.fail('report', { status: 409, body: probaraError('conflict') }, { from: 2, times: 1 });
    },
  },
  /** Members `assignFailedTo` may name: `ana@example.com` and `bo@example.com`, no one else. */
  members: { fake: { members: ['ana@example.com', 'bo@example.com'] } },
  /** No token and no project: reporting stays off and quiet. */
  'not-configured': { env: { PROBARA_API_TOKEN: undefined, PROBARA_PROJECT: undefined } },
  /** The run `01J9Z3K4M5N6P7Q8R9S0T1V2W3` of the docs, open and empty, as `probara run create` left it. */
  'existing-run': {
    setup: (fake) => {
      fake.seedRun({ ulid: DOCS_RUN, projectId: 'SHOP' });
    },
  },
  /**
   * The run `01J9Z3K4M5N6P7Q8R9S0T1V2W3` of the docs, open, with two cases of the docs project's
   * tests: `SHOP-12`, named in a title, and `SHOP-30`, linked by the key of the login test.
   */
  'run-cases': { setup: seedRunWithCases },
  /** `run-cases`, in the job that runs its tests: `PROBARA_RUN_CASES_ONLY` and its ULID set. */
  'run-cases-only': {
    env: { PROBARA_RUN_CASES_ONLY: 'true', PROBARA_RUN_ULID: DOCS_RUN },
    setup: seedRunWithCases,
  },
  /** `run-cases`, but reading its case keys is refused with a 403. */
  'run-cases-refused': {
    setup: (fake) => {
      seedRunWithCases(fake);
      fake.fail('caseKeys', { status: 403, body: probaraError('forbidden') });
    },
  },
  /** The run of the docs with one case, `SHOP-99`, which no test of the docs project names. */
  'run-cases-unmatched': {
    setup: (fake) => {
      fake.seedRun({
        ulid: DOCS_RUN,
        projectId: 'SHOP',
        cases: [{ caseDisplayId: 'SHOP-99', automationKey: null }],
      });
    },
  },
};
