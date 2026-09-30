/**
 * The setups behind `<!-- output: <id> -->` blocks. The command comes from the block's `$ ` line;
 * a scenario only says what the environment and the fake Probara look like.
 */
import type { FakeProbara } from '@probara/test-support/fake-probara';

export interface Scenario {
  /** Merged over the configured job's environment; `undefined` removes a variable. */
  env?: Record<string, string | undefined>;
  setup?: (fake: FakeProbara) => void;
  /** What the block shows. Defaults to both streams in the order they were written. */
  stream?: 'combined' | 'stdout' | 'stderr';
}

/**
 * An error body whose message stands for whatever Probara says: the docs never quote a server
 * message the fake made up.
 */
function probaraError(code: string) {
  return { error: { code, message: '<message from Probara>' } };
}

const UNCONFIGURED = { PROBARA_API_TOKEN: undefined, PROBARA_PROJECT: undefined };

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  /** A plain import into a new run. */
  import: {},
  /** An import whose report is retried after a 429. */
  'rate-limited': {
    setup: (fake) => {
      fake.fail('report', { status: 429, headers: { 'retry-after': '2' } }, { times: 1 });
    },
  },
  /** Every attempt of the report fails with a 503. */
  'server-down': {
    setup: (fake) => {
      fake.fail('report', { status: 503, body: probaraError('internal_error') });
    },
  },
  /** The token is refused. */
  unauthorized: {
    setup: (fake) => {
      fake.fail('report', { status: 401, body: probaraError('unauthorized') });
    },
  },
  /** The first report of two is recorded, every attempt of the second fails. */
  partial: {
    setup: (fake) => {
      fake.fail('report', { status: 503, body: probaraError('internal_error') }, { from: 2 });
    },
  },
  /** No token and no project. */
  'not-configured': { env: UNCONFIGURED },
  /** Only the project: a fork pull request without secrets. */
  'no-token': { env: { PROBARA_API_TOKEN: undefined } },
  /** A dry run without any credential. */
  'dry-run': { env: UNCONFIGURED },
  /** A dry run that knows the project, so ids in names link. */
  'dry-run-project': { env: { PROBARA_API_TOKEN: undefined } },
  /** Only the log of a dry run that knows the project. */
  'dry-run-log': { env: { PROBARA_API_TOKEN: undefined }, stream: 'stderr' },
  /** Only stdout of a dry run. */
  'dry-run-stdout': { env: { PROBARA_API_TOKEN: undefined }, stream: 'stdout' },
  /** Only stdout: what a script reads. */
  stdout: { stream: 'stdout' },
  /** Reporting turned off. */
  disabled: { env: { PROBARA_ENABLED: 'false' } },
};
