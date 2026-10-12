/**
 * The setups behind `scenario: <id>` in output, sent and files blocks. The command comes from the block; a scenario
 * only says what the environment and the fake Probara look like.
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
   * A `vitest --watch` session: how many runs it makes (2 by default: the first and one re-run), and what happens to
   * Probara between two of them.
   */
  watch?: { runs?: number; between?: (fake: FakeProbara, ended: number) => void };
}

/**
 * The organization of the docs, whatever the scenario: it has the custom field `Risk area` that `docs/metadata.md` sets
 * on a created case.
 */
const DOCS_ORGANIZATION: FakeProbaraOptions = { customFields: ['Risk area'] };

/** The fake Probara of `scenario`, in the organization of the docs, taking the tests' token. */
export function startDocsFake(scenario: Scenario = {}): Promise<FakeProbara> {
  return startFakeProbara({ ...DOCS_ORGANIZATION, ...scenario.fake, token: TOKEN });
}

/**
 * The scenarios of this page set: what the examples so far need. A scenario is added with the first block that names it,
 * and `examples-run.test.ts` fails on one no block names.
 */
export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  /** A configured job and a Probara that records everything. */
  '': {},
  /** A `vitest --watch` session: its first run, and one re-run after a test file is saved. */
  watch: { watch: { runs: 2 } },
};
