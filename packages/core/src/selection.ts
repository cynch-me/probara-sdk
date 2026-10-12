/**
 * The matcher of run selection (`runCasesOnly`): the tests that belong to the cases of a Probara run. A test belongs
 * to the run when one of the case ids its names hold (`SHOP-12`) is a case of the run, or when its automation key is
 * the key of one of the run's cases. The ids of `probara.id()` count for nothing here: that call happens as the test
 * runs, after the selection. Each adapter reads a test's names its own way, then matches them with this function.
 */

/** The cases a selection takes its tests from: the automation keys and the display ids (`SHOP-12`) of a run's cases. */
export interface RunCases {
  keys: readonly string[];
  caseIds: readonly string[];
}

/** A test as the matcher reads it: the case ids its names hold, and its automation key when it has one. */
export interface SelectableTest {
  ids: readonly string[];
  key?: string | undefined;
}

/** Whether a test belongs to the cases of a run. */
export type RunSelector = (test: SelectableTest) => boolean;

/** The matcher of the cases of `cases`. Its sets are built once, so a run's many tests are matched cheaply. */
export function createRunSelector(cases: RunCases): RunSelector {
  const keys = new Set(cases.keys);
  const caseIds = new Set(cases.caseIds);
  return (test) => {
    if (test.ids.some((id) => caseIds.has(id))) return true;
    return test.key !== undefined && keys.has(test.key);
  };
}
