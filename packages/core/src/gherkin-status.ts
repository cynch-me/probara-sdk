/**
 * How Cucumber's step and scenario statuses become result statuses, for every adapter that reads
 * Cucumber output: the Cucumber JSON report (lowercase names) and the Cucumber Messages (uppercase
 * names) alike.
 */
import type { ResultStatus } from './api.js';

const PASSED: ReadonlySet<unknown> = new Set(['passed', 'PASSED']);
const FAILED: ReadonlySet<unknown> = new Set(['failed', 'FAILED', 'ambiguous', 'AMBIGUOUS']);

/**
 * A Cucumber step's status as a result status: `passed` passes; `failed` and `ambiguous` fail; every
 * other status (`skipped`, `pending`, `undefined`, `unknown`, or none) did not run, so it is skipped.
 */
export function cucumberStepStatus(status: unknown): ResultStatus {
  if (PASSED.has(status)) return 'passed';
  if (FAILED.has(status)) return 'failed';
  return 'skipped';
}

/**
 * A scenario's status from the statuses of its steps and of its failed hooks (each a failure): failed
 * if any failed, else skipped if any did not run, else passed.
 */
export function scenarioStatus(statuses: readonly ResultStatus[]): ResultStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('skipped')) return 'skipped';
  return 'passed';
}
